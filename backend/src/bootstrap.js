// Idempotent boot-time migration + demo-account seeding.
// Safe to run on every start (backend and worker both call it).
const bcrypt = require('bcryptjs');
const pool = require('./db');
const config = require('./config');
const logger = require('./logger');

async function migrate() {
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

    CREATE TABLE IF NOT EXISTS user_api_keys (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      client_id TEXT NOT NULL,
      client_secret_enc TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, platform)
    );
  `);
}

// The presentation account: logs in with DEMO_EMAIL / DEMO_PASSWORD from
// .env and always runs on the mock provider — instant, rich data on stage.
async function seedDemoUser() {
  const { email, password } = config.demo;
  if (!password) {
    logger.info('demo account disabled (no DEMO_PASSWORD set)');
    return;
  }
  const hash = await bcrypt.hash(password, 12);
  await pool.query(`
    INSERT INTO users (name, email, password_hash, timezone, is_demo)
    VALUES ('Demo Presenter', $1, $2, 'Asia/Kolkata', TRUE)
    ON CONFLICT (email) DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      is_demo = TRUE`,
    [email, hash]);
  logger.info({ email }, 'demo account ready');
}

async function bootstrap() {
  // wait for postgres (compose healthchecks cover this, but be resilient)
  for (let i = 0; i < 20; i++) {
    try {
      await migrate();
      await seedDemoUser();
      return;
    } catch (e) {
      if (i === 19) throw e;
      logger.warn({ err: e.message, attempt: i + 1 }, 'bootstrap retrying in 3s');
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

module.exports = { bootstrap };
