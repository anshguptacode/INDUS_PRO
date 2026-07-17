const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: +(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'footprint',
  password: process.env.PGPASSWORD || 'footprint',
  database: process.env.PGDATABASE || 'footprint',
  max: 10,
  idleTimeoutMillis: 30000,
});

module.exports = pool;
