const jwt = require('jsonwebtoken');
const config = require('../config');

// short-lived access token + rotating refresh token (stored hashed in PG)
function signAccess(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name },
    config.jwtSecret, { expiresIn: '15m' });
}

function signRefresh(user) {
  return jwt.sign({ id: user.id, type: 'refresh' },
    config.jwtRefreshSecret, { expiresIn: '30d' });
}

function verifyRefresh(token) {
  return jwt.verify(token, config.jwtRefreshSecret);
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing token' });
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: 'invalid or expired token' });
  }
}

module.exports = { signAccess, signRefresh, verifyRefresh, requireAuth };
