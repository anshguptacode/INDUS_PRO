// Real-time bridge: workers publish events on Redis; the API process
// forwards them to the right user's browser over socket.io.
const { Server } = require('socket.io');
const { createClient } = require('redis');
const jwt = require('jsonwebtoken');
const config = require('./config');
const logger = require('./logger');

const CHANNEL = 'footprint:events';

function initRealtime(httpServer) {
  const io = new Server(httpServer, { path: '/api/socket.io' });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      socket.user = jwt.verify(token, config.jwtSecret);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.user.id}`);
  });

  const sub = createClient({ url: config.redisUrl });
  sub.connect()
    .then(() => sub.subscribe(CHANNEL, (msg) => {
      try {
        const { userId, event, payload } = JSON.parse(msg);
        io.to(`user:${userId}`).emit(event, payload);
      } catch (e) {
        logger.warn({ err: e.message }, 'bad realtime message');
      }
    }))
    .catch((e) => logger.warn({ err: e.message }, 'realtime subscribe failed'));

  return io;
}

// used by worker processes
async function publish(redisClient, userId, event, payload) {
  await redisClient.publish(CHANNEL, JSON.stringify({ userId, event, payload }));
}

module.exports = { initRealtime, publish, CHANNEL };
