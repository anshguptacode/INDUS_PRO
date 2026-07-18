// Provider registry + per-user resolution.
//
// Who gets what:
//   demo account            -> mock provider, always (presentation mode)
//   user saved own API keys -> real provider with THEIR credentials
//   server has env keys     -> real provider with server credentials (unless MOCK_MODE)
//   MOCK_MODE=true          -> mock provider
//   otherwise               -> NEEDS_KEYS error (user must add keys first)
const config = require('../config');
const pool = require('../db');
const { decrypt } = require('../crypto');
const twitter = require('./twitter');
const instagram = require('./instagram');
const github = require('./github');
const mock = require('./mock');

const REAL = { twitter, instagram, github };
const PLATFORMS = ['twitter', 'instagram', 'github'];

function assertPlatform(platform) {
  if (!PLATFORMS.includes(platform) && platform !== 'mock') {
    throw new Error(`unknown platform: ${platform}`);
  }
}

async function isDemoUser(userId) {
  const { rows } = await pool.query('SELECT is_demo FROM users WHERE id = $1', [userId]);
  return Boolean(rows[0]?.is_demo);
}

async function ownKeys(userId, platform) {
  const { rows } = await pool.query(
    'SELECT client_id, client_secret_enc FROM user_api_keys WHERE user_id = $1 AND platform = $2',
    [userId, platform]);
  if (!rows[0]) return null;
  return { clientId: rows[0].client_id, clientSecret: decrypt(rows[0].client_secret_enc) };
}

async function resolveProvider(platform, userId) {
  assertPlatform(platform);
  const real = REAL[platform];

  if (await isDemoUser(userId)) {
    return { provider: mock, isMock: true, mode: 'demo', creds: null };
  }
  const creds = await ownKeys(userId, platform);
  if (creds) return { provider: real, isMock: false, mode: 'own-keys', creds };

  if (!config.mockMode && real?.isConfigured()) {
    return { provider: real, isMock: false, mode: 'server-keys', creds: null };
  }
  if (config.mockMode) return { provider: mock, isMock: true, mode: 'mock', creds: null };

  const err = new Error(
    `no API keys for ${platform} — add your own keys on the Accounts page first`);
  err.code = 'NEEDS_KEYS';
  throw err;
}

// Per-user platform status for the Accounts page.
async function platformStatusFor(userId) {
  const demo = await isDemoUser(userId);
  const { rows } = await pool.query(
    'SELECT platform, client_id FROM user_api_keys WHERE user_id = $1', [userId]);
  const own = Object.fromEntries(rows.map((r) => [r.platform, r.client_id]));

  return PLATFORMS.map((p) => {
    let mode;
    if (demo) mode = 'demo';
    else if (own[p]) mode = 'own-keys';
    else if (!config.mockMode && REAL[p].isConfigured()) mode = 'server-keys';
    else if (config.mockMode) mode = 'mock';
    else mode = 'needs-keys';
    return {
      platform: p,
      mode,
      is_demo_user: demo,
      has_own_keys: Boolean(own[p]),
      client_id_masked: own[p] ? `${own[p].slice(0, 4)}…${own[p].slice(-4)}` : null,
    };
  });
}

module.exports = { resolveProvider, platformStatusFor, PLATFORMS };
