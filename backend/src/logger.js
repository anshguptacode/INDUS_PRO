const pino = require('pino');

module.exports = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: undefined, // drop pid/hostname noise
  timestamp: pino.stdTimeFunctions.isoTime,
});
