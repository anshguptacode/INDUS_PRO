const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/insights', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (insight_type) insight_type, payload, generated_at
       FROM insights WHERE user_id = $1
      ORDER BY insight_type, generated_at DESC`, [req.user.id]);
  res.json(rows);
});

router.get('/predictions', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT platform, target_date::text, predicted_low, predicted_high,
            confidence::float, model
       FROM predictions
      WHERE user_id = $1 AND target_date >= CURRENT_DATE
      ORDER BY target_date, platform`, [req.user.id]);
  res.json(rows);
});

router.get('/accounts', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, platform, handle, connected_at, last_synced_at, sync_error
       FROM social_accounts WHERE user_id = $1 ORDER BY id`, [req.user.id]);
  res.json(rows);
});

// recent background jobs — drives the "sync activity" panel
router.get('/sync-jobs', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT sj.id, sa.platform, sj.status, sj.detail, sj.started_at, sj.finished_at
       FROM sync_jobs sj LEFT JOIN social_accounts sa ON sa.id = sj.account_id
      WHERE sj.user_id = $1 ORDER BY sj.started_at DESC LIMIT 15`, [req.user.id]);
  res.json(rows);
});

module.exports = router;
