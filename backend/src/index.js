const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const pinoHttp = require('pino-http');
const config = require('./config');
const logger = require('./logger');
const { initRealtime } = require('./realtime');
const { bootstrap } = require('./bootstrap');

const app = express();
app.set('trust proxy', 1); // behind nginx

app.use(helmet());
app.use(compression());
app.use(cors({ origin: config.baseUrl, credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));

// global + auth-specific rate limits
app.use('/api/', rateLimit({ windowMs: 60000, max: 300, standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth/', rateLimit({ windowMs: 15 * 60000, max: 25, standardHeaders: true, legacyHeaders: false }));

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'backend', mock_mode: config.mockMode }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/connect', require('./routes/connect'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api', require('./routes/insights'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/keys', require('./routes/keys'));

// central error handler — never leak stack traces
app.use((err, req, res, _next) => {
  req.log?.error(err);
  res.status(500).json({ error: 'internal error' });
});

const server = http.createServer(app);
initRealtime(server);
bootstrap()
  .then(() => server.listen(config.port, () =>
    logger.info({ port: config.port, mockMode: config.mockMode }, 'backend up')))
  .catch((e) => { logger.error(e, 'bootstrap failed'); process.exit(1); });
