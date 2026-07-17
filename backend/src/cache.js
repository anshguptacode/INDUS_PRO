const { createClient } = require('redis');
const config = require('./config');
const logger = require('./logger');

const client = createClient({ url: config.redisUrl });
client.on('error', (err) => logger.warn({ err: err.message }, 'redis error'));
client.connect().catch(() => logger.warn('redis unavailable — caching disabled'));

const TTL = 300;

async function cached(key, fn, ttl = TTL) {
  try {
    if (client.isReady) {
      const hit = await client.get(key);
      if (hit) return JSON.parse(hit);
    }
  } catch { /* fall through to fresh fetch */ }
  const fresh = await fn();
  try {
    if (client.isReady) await client.set(key, JSON.stringify(fresh), { EX: ttl });
  } catch { /* best effort */ }
  return fresh;
}

async function invalidateUser(userId) {
  if (!client.isReady) return;
  for await (const key of client.scanIterator({ MATCH: `u${userId}:*` })) {
    await client.del(key);
  }
}

module.exports = { cached, invalidateUser, client };
