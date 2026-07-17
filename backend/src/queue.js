const { Queue } = require('bullmq');
const config = require('./config');

const connection = { url: config.redisUrl };
const syncQueue = new Queue('sync', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

async function enqueueSync(accountId, userId, delayMs = 0) {
  return syncQueue.add('sync-account', { accountId, userId }, {
    delay: delayMs,
    jobId: delayMs ? undefined : `sync-${accountId}-now`, // dedupe immediate syncs
  });
}

module.exports = { syncQueue, enqueueSync, connection };
