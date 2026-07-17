const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const config = require('../config');
const { encrypt } = require('../crypto');
const { requireAuth } = require('../middleware/auth');
const { getProvider, platformStatus } = require('../providers');
const { client: redis } = require('../cache');
const { enqueueSync } = require('../queue');

const router = express.Router();

const redirectUri = (platform) => `${config.baseUrl}/api/connect/${platform}/callback`;
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

router.get('/status', requireAuth, (_req, res) => res.json(platformStatus()));

// Step 1: get the provider's consent URL (or connect instantly in mock mode)
router.get('/:platform', requireAuth, async (req, res) => {
  const { platform } = req.params;
  try {
    const { provider, isMock } = getProvider(platform);

    if (isMock) {
      const account = await upsertAccount(req.user.id, platform, {
        providerUserId: `mock_${req.user.id}_${platform}`,
        handle: `${req.user.name.split(' ')[0].toLowerCase()}_${platform}`,
      }, { accessToken: 'mock-token', refreshToken: null, expiresAt: null, scopes: 'mock' });
      await enqueueSync(account.id, req.user.id);
      return res.json({ connected: true, mock: true, platform });
    }

    const state = b64url(crypto.randomBytes(24));
    const codeVerifier = b64url(crypto.randomBytes(48));
    const codeChallenge = b64url(crypto.createHash('sha256').update(codeVerifier).digest());
    await redis.set(`oauth:${state}`,
      JSON.stringify({ userId: req.user.id, platform, codeVerifier }), { EX: 600 });

    res.json({ url: provider.authUrl({ redirectUri: redirectUri(platform), state, codeChallenge }) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Step 2: provider redirects the browser here
router.get('/:platform/callback', async (req, res) => {
  const { platform } = req.params;
  const { code, state, error } = req.query;
  const fail = (msg) => res.redirect(`${config.baseUrl}/accounts?error=${encodeURIComponent(msg)}`);
  if (error) return fail(error);
  if (!code || !state) return fail('missing code/state');

  const stored = await redis.getDel(`oauth:${state}`);
  if (!stored) return fail('state expired — try connecting again');
  const { userId, codeVerifier, platform: expected } = JSON.parse(stored);
  if (expected !== platform) return fail('state/platform mismatch');

  try {
    const { provider } = getProvider(platform);
    const tokens = await provider.exchangeCode({
      code, redirectUri: redirectUri(platform), codeVerifier,
    });
    const profile = await provider.fetchProfile(tokens.accessToken);
    const account = await upsertAccount(userId, platform, profile, tokens);
    await enqueueSync(account.id, userId);
    res.redirect(`${config.baseUrl}/accounts?connected=${platform}`);
  } catch (e) {
    req.log?.error(e);
    fail(`could not connect ${platform}: ${e.message}`);
  }
});

router.delete('/:platform', requireAuth, async (req, res) => {
  await pool.query(
    'DELETE FROM social_accounts WHERE user_id = $1 AND platform = $2',
    [req.user.id, req.params.platform]);
  res.json({ status: 'disconnected' });
});

async function upsertAccount(userId, platform, profile, tokens) {
  const { rows } = await pool.query(`
    INSERT INTO social_accounts (user_id, platform, handle, provider_user_id,
        access_token_enc, refresh_token_enc, token_expires_at, scopes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (user_id, platform) DO UPDATE SET
        handle = EXCLUDED.handle,
        provider_user_id = EXCLUDED.provider_user_id,
        access_token_enc = EXCLUDED.access_token_enc,
        refresh_token_enc = EXCLUDED.refresh_token_enc,
        token_expires_at = EXCLUDED.token_expires_at,
        scopes = EXCLUDED.scopes,
        sync_error = NULL
    RETURNING id`,
    [userId, platform, profile.handle, profile.providerUserId,
      encrypt(tokens.accessToken), encrypt(tokens.refreshToken),
      tokens.expiresAt, tokens.scopes]);
  return rows[0];
}

module.exports = router;
