const express = require('express');
const pool = require('../db');
const { cached } = require('../cache');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/summary', async (req, res) => {
  const uid = req.user.id;
  const data = await cached(`u${uid}:summary`, async () => {
    const followers = await pool.query(
      `SELECT COALESCE(SUM(fh.followers), 0)::int AS total
         FROM social_accounts sa
         JOIN LATERAL (
           SELECT followers FROM follower_history
            WHERE account_id = sa.id ORDER BY snapshot DESC LIMIT 1
         ) fh ON true
        WHERE sa.user_id = $1`, [uid]);

    const engagement = await pool.query(
      `SELECT ROUND(AVG(p.engagement_rate), 2) AS avg_er, COUNT(*)::int AS posts
         FROM posts p JOIN social_accounts sa ON sa.id = p.account_id
        WHERE sa.user_id = $1`, [uid]);

    const momChange = await pool.query(
      `WITH monthly AS (
         SELECT date_trunc('month', p.posted_at) AS m, AVG(p.engagement_rate) AS er
           FROM posts p JOIN social_accounts sa ON sa.id = p.account_id
          WHERE sa.user_id = $1 GROUP BY 1 ORDER BY 1 DESC LIMIT 2)
       SELECT ROUND(100 * (MAX(er) FILTER (WHERE rn = 1) / NULLIF(MAX(er) FILTER (WHERE rn = 2), 0) - 1), 1) AS pct
         FROM (SELECT er, ROW_NUMBER() OVER (ORDER BY m DESC) rn FROM monthly) t`, [uid]);

    return {
      total_followers: followers.rows[0].total,
      avg_engagement_rate: +engagement.rows[0].avg_er || 0,
      total_posts: engagement.rows[0].posts,
      engagement_change_pct: +momChange.rows[0].pct || 0,
    };
  }, 60); // short TTL — dashboard feels live
  res.json(data);
});

router.get('/engagement-trend', async (req, res) => {
  const uid = req.user.id;
  res.json(await cached(`u${uid}:engagement-trend`, async () => {
    const { rows } = await pool.query(
      `SELECT to_char(date_trunc('month', p.posted_at), 'YYYY-MM') AS month,
              p.platform, ROUND(AVG(p.engagement_rate), 2)::float AS engagement_rate
         FROM posts p JOIN social_accounts sa ON sa.id = p.account_id
        WHERE sa.user_id = $1 GROUP BY 1, 2 ORDER BY 1`, [uid]);
    return rows;
  }));
});

router.get('/follower-growth', async (req, res) => {
  const uid = req.user.id;
  res.json(await cached(`u${uid}:follower-growth`, async () => {
    const { rows } = await pool.query(
      `SELECT date_trunc('day', fh.snapshot)::date::text AS week,
              MAX(fh.followers)::int AS followers
         FROM follower_history fh JOIN social_accounts sa ON sa.id = fh.account_id
        WHERE sa.user_id = $1 GROUP BY 1 ORDER BY 1`, [uid]);
    return rows;
  }, 60));
});

router.get('/sentiment-trend', async (req, res) => {
  const uid = req.user.id;
  res.json(await cached(`u${uid}:sentiment-trend`, async () => {
    const { rows } = await pool.query(
      `SELECT to_char(date_trunc('month', p.posted_at), 'YYYY-MM') AS month,
              ROUND(100.0 * COUNT(*) FILTER (WHERE sentiment_label = 'positive') / COUNT(*), 1)::float AS positive,
              ROUND(100.0 * COUNT(*) FILTER (WHERE sentiment_label = 'neutral')  / COUNT(*), 1)::float AS neutral,
              ROUND(100.0 * COUNT(*) FILTER (WHERE sentiment_label = 'negative') / COUNT(*), 1)::float AS negative
         FROM posts p JOIN social_accounts sa ON sa.id = p.account_id
        WHERE sa.user_id = $1 AND p.sentiment_label IS NOT NULL
        GROUP BY 1 ORDER BY 1`, [uid]);
    return rows;
  }));
});

router.get('/topic-performance', async (req, res) => {
  const uid = req.user.id;
  res.json(await cached(`u${uid}:topic-performance`, async () => {
    const { rows } = await pool.query(
      `SELECT p.topic, ROUND(AVG(p.likes))::int AS avg_likes,
              ROUND(AVG(p.engagement_rate), 2)::float AS avg_er, COUNT(*)::int AS posts
         FROM posts p JOIN social_accounts sa ON sa.id = p.account_id
        WHERE sa.user_id = $1 AND p.topic IS NOT NULL
        GROUP BY 1 ORDER BY avg_likes DESC`, [uid]);
    return rows;
  }));
});

router.get('/heatmap', async (req, res) => {
  const uid = req.user.id;
  res.json(await cached(`u${uid}:heatmap`, async () => {
    const { rows } = await pool.query(
      `SELECT EXTRACT(ISODOW FROM p.posted_at AT TIME ZONE u.timezone)::int AS dow,
              EXTRACT(HOUR FROM p.posted_at AT TIME ZONE u.timezone)::int AS hour,
              ROUND(AVG(p.likes + p.comments + p.shares))::int AS engagement,
              COUNT(*)::int AS posts
         FROM posts p
         JOIN social_accounts sa ON sa.id = p.account_id
         JOIN users u ON u.id = sa.user_id
        WHERE sa.user_id = $1 GROUP BY 1, 2`, [uid]);
    return rows;
  }));
});

router.get('/top-posts', async (req, res) => {
  const uid = req.user.id;
  const limit = Math.min(+(req.query.limit || 5), 25);
  res.json(await cached(`u${uid}:top-posts:${limit}`, async () => {
    const { rows } = await pool.query(
      `SELECT p.content, p.platform, p.likes, p.comments, p.shares,
              p.engagement_rate::float, p.sentiment_label, p.posted_at
         FROM posts p JOIN social_accounts sa ON sa.id = p.account_id
        WHERE sa.user_id = $1 ORDER BY p.likes DESC LIMIT $2`, [uid, limit]);
    return rows;
  }));
});

module.exports = router;
