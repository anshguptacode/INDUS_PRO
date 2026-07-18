// Sync worker process — separate from the API so heavy fetches never block
// requests. Also schedules the recurring re-sync that powers "real-time".
const { Worker, Queue } = require('bullmq');
const { createClient } = require('redis');
const axios = require('axios');
const pool = require('../db');
const config = require('../config');
const logger = require('../logger');
const { decrypt, encrypt } = require('../crypto');
const { rawPosts } = require('../mongo');
const { resolveProvider } = require('../providers');
const { RateLimitError } = require('../providers/base');
const { publish } = require('../realtime');
const { connection } = require('../queue');
const { bootstrap } = require('../bootstrap');

const pub = createClient({ url: config.redisUrl });
pub.connect().catch(() => logger.warn('worker: redis pub unavailable'));

async function processAccount(job) {
  const { accountId, userId } = job.data;
  const { rows } = await pool.query('SELECT * FROM social_accounts WHERE id = $1', [accountId]);
  const account = rows[0];
  if (!account) return { skipped: 'account deleted' };

  const jobRow = await pool.query(
    `INSERT INTO sync_jobs (user_id, account_id, status) VALUES ($1, $2, 'running') RETURNING id`,
    [userId, accountId]);
  const jobId = jobRow.rows[0].id;

  try {
    const { provider, isMock, creds } = await resolveProvider(account.platform, userId);
    let accessToken = decrypt(account.access_token_enc);

    // refresh tokens BEFORE they expire (30-min margin). Critical for
    // Instagram: Meta long-lived tokens can only be re-exchanged while
    // still valid — waiting until expiry would strand the account.
    const REFRESH_MARGIN_MS = 30 * 60 * 1000;
    if (!isMock && account.token_expires_at
        && new Date(account.token_expires_at) < new Date(Date.now() + REFRESH_MARGIN_MS)) {
      const fresh = await provider.refresh(decrypt(account.refresh_token_enc), accessToken, creds);
      accessToken = fresh.accessToken;
      await pool.query(
        `UPDATE social_accounts SET access_token_enc = $1,
            refresh_token_enc = COALESCE($2, refresh_token_enc), token_expires_at = $3
          WHERE id = $4`,
        [encrypt(fresh.accessToken), encrypt(fresh.refreshToken), fresh.expiresAt, accountId]);
    }

    // profile snapshot -> follower_history (this builds the growth series)
    const profile = await provider.fetchProfile(accessToken, account.handle);
    await pool.query(
      'INSERT INTO follower_history (account_id, followers, following) VALUES ($1, $2, $3)',
      [accountId, profile.followers, profile.following]);

    // incremental fetch: newest external_id we already have
    const col = await rawPosts();
    const newest = await col.find({ account_id: accountId })
      .sort({ created_at: -1 }).limit(1).toArray();
    const sinceId = newest[0]?.external_id?.replace(/^\w{2}_/, '');

    const docs = await provider.fetchPosts(
      accessToken, account.provider_user_id, sinceId, account.platform);
    let inserted = 0;
    for (const doc of docs) {
      const r = await col.updateOne(
        { platform: doc.platform, external_id: doc.external_id },
        { $set: { ...doc, account_id: accountId, fetched_at: new Date().toISOString() } },
        { upsert: true });
      if (r.upsertedCount) inserted++;
    }

    // run the analytics pipeline (clean -> sentiment -> insights -> forecast)
    const { data: analytics } = await axios.post(
      `${config.analyticsUrl}/run/${userId}`, {}, { timeout: 180000 });

    await pool.query(
      `UPDATE social_accounts SET last_synced_at = now(), sync_error = NULL WHERE id = $1`,
      [accountId]);
    const detail = { fetched: docs.length, new_posts: inserted, analytics: analytics.cleaning };
    await pool.query(
      `UPDATE sync_jobs SET status = 'done', detail = $1, finished_at = now() WHERE id = $2`,
      [JSON.stringify(detail), jobId]);

    // stale dashboards are worse than cold ones
    const { invalidateUser } = require('../cache');
    await invalidateUser(userId);

    await publish(pub, userId, 'sync:complete', {
      platform: account.platform, ...detail,
    });
    logger.info({ accountId, platform: account.platform, ...detail }, 'sync done');
    return detail;
  } catch (e) {
    await pool.query(
      `UPDATE sync_jobs SET status = 'failed', detail = $1, finished_at = now() WHERE id = $2`,
      [JSON.stringify({ error: e.message }), jobId]);
    await pool.query('UPDATE social_accounts SET sync_error = $1 WHERE id = $2',
      [e.message, accountId]);

    if (e instanceof RateLimitError) {
      // don't burn retries on a rate limit — reschedule after the window
      const { enqueueSync } = require('../queue');
      await enqueueSync(accountId, userId, e.retryAfterMs);
      logger.warn({ accountId, retryInMs: e.retryAfterMs }, 'rate limited, rescheduled');
      return { rescheduled: true };
    }
    await publish(pub, userId, 'sync:error', { platform: account.platform, error: e.message });
    throw e;
  }
}

new Worker('sync', processAccount, { connection, concurrency: 3 });

// recurring re-sync of every connected account
const scheduler = new Queue('scheduler', { connection });
new Worker('scheduler', async () => {
  const { enqueueSync } = require('../queue');
  const { rows } = await pool.query('SELECT id, user_id FROM social_accounts');
  for (const a of rows) await enqueueSync(a.id, a.user_id);
  logger.info({ accounts: rows.length }, 'scheduled re-sync');
}, { connection });

(async () => {
  await bootstrap();
  await scheduler.upsertJobScheduler('periodic-sync',
    { every: config.syncIntervalMinutes * 60000 }, { name: 'tick' });
  logger.info({ everyMinutes: config.syncIntervalMinutes }, 'sync worker up');
})();
