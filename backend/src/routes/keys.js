// Per-user API keys — each signed-up user supplies their own OAuth app
// credentials per platform. Secrets are AES-256-GCM encrypted at rest and
// never returned to the browser (only a masked client id).
const express = require('express');
const pool = require('../db');
const { encrypt } = require('../crypto');
const { requireAuth } = require('../middleware/auth');
const { PLATFORMS } = require('../providers');

const router = express.Router();

async function rejectDemo(req, res) {
  const { rows } = await pool.query('SELECT is_demo FROM users WHERE id = $1', [req.user.id]);
  if (rows[0]?.is_demo) {
    res.status(403).json({ error: 'the demo account uses built-in data — API keys are not needed' });
    return true;
  }
  return false;
}

// list saved keys (masked)
router.get('/', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT platform, client_id, created_at FROM user_api_keys WHERE user_id = $1',
    [req.user.id]);
  res.json(rows.map((r) => ({
    platform: r.platform,
    client_id_masked: `${r.client_id.slice(0, 4)}…${r.client_id.slice(-4)}`,
    created_at: r.created_at,
  })));
});

// save / replace keys for one platform
router.put('/:platform', requireAuth, async (req, res) => {
  const { platform } = req.params;
  if (!PLATFORMS.includes(platform)) return res.status(400).json({ error: 'unknown platform' });
  if (await rejectDemo(req, res)) return;

  const { clientId, clientSecret } = req.body || {};
  if (!clientId || !clientSecret) {
    return res.status(400).json({ error: 'clientId and clientSecret are required' });
  }
  if (clientId.length > 200 || clientSecret.length > 500) {
    return res.status(400).json({ error: 'key looks malformed (too long)' });
  }

  await pool.query(`
    INSERT INTO user_api_keys (user_id, platform, client_id, client_secret_enc)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, platform) DO UPDATE SET
      client_id = EXCLUDED.client_id,
      client_secret_enc = EXCLUDED.client_secret_enc,
      created_at = now()`,
    [req.user.id, platform, clientId.trim(), encrypt(clientSecret.trim())]);

  res.json({ status: 'saved', platform });
});

// remove keys (platform falls back to server keys / mock / needs-keys)
router.delete('/:platform', requireAuth, async (req, res) => {
  if (await rejectDemo(req, res)) return;
  await pool.query(
    'DELETE FROM user_api_keys WHERE user_id = $1 AND platform = $2',
    [req.user.id, req.params.platform]);
  res.json({ status: 'removed' });
});

module.exports = router;
