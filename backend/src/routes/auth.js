const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { sha256 } = require('../crypto');
const { signAccess, signRefresh, verifyRefresh } = require('../middleware/auth');

const router = express.Router();

async function issueTokens(res, user) {
  const access = signAccess(user);
  const refresh = signRefresh(user);
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + interval '30 days')`,
    [user.id, sha256(refresh)]);
  res.json({
    token: access,
    refreshToken: refresh,
    user: { id: user.id, name: user.name, email: user.email, is_demo: Boolean(user.is_demo) },
  });
}

router.post('/register', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password required' });
  if (password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, is_demo',
      [name, email.toLowerCase(), hash]);
    await issueTokens(res, rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'email already registered' });
    req.log.error(e);
    res.status(500).json({ error: 'registration failed' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'invalid credentials' });
  }
  await issueTokens(res, user);
});

// rotate: old refresh token is revoked, new pair issued
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });
  try {
    const payload = verifyRefresh(refreshToken);
    const del = await pool.query(
      'DELETE FROM refresh_tokens WHERE token_hash = $1 AND expires_at > now() RETURNING user_id',
      [sha256(refreshToken)]);
    if (!del.rowCount) return res.status(401).json({ error: 'refresh token revoked' });
    const { rows } = await pool.query('SELECT id, name, email, is_demo FROM users WHERE id = $1', [payload.id]);
    await issueTokens(res, rows[0]);
  } catch {
    res.status(401).json({ error: 'invalid refresh token' });
  }
});

router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken) {
    await pool.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [sha256(refreshToken)]);
  }
  res.json({ status: 'ok' });
});

module.exports = router;
