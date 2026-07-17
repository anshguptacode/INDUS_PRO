const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { enqueueSync } = require('../queue');
const { invalidateUser } = require('../cache');

const router = express.Router();
router.use(requireAuth);

// Manual "sync now" — enqueues one job per connected account.
router.post('/', async (req, res) => {
  const uid = req.user.id;
  const { rows } = await pool.query(
    'SELECT id FROM social_accounts WHERE user_id = $1', [uid]);
  if (!rows.length) return res.status(400).json({ error: 'connect an account first' });
  for (const a of rows) await enqueueSync(a.id, uid);
  await invalidateUser(uid);
  res.status(202).json({ status: 'queued', accounts: rows.length });
});

module.exports = router;
