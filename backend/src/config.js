// Central config — fail fast on missing critical secrets in production.
const required = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'TOKEN_ENC_KEY'];

const config = {
  env: process.env.NODE_ENV || 'development',
  port: +(process.env.PORT || 4000),
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
  tokenEncKey: process.env.TOKEN_ENC_KEY || '00'.repeat(32),
  mockMode: (process.env.MOCK_MODE || 'true').toLowerCase() === 'true',
  syncIntervalMinutes: +(process.env.SYNC_INTERVAL_MINUTES || 15),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  mongoUrl: process.env.MONGO_URL || 'mongodb://localhost:27017',
  analyticsUrl: process.env.ANALYTICS_URL || 'http://localhost:8000',
  // presentation demo account — seeded at boot, always uses mock data
  demo: {
    email: (process.env.DEMO_EMAIL || 'demo@footprint.pro').toLowerCase(),
    password: process.env.DEMO_PASSWORD || '',   // empty = demo account disabled
  },
  providers: {
    twitter: {
      clientId: process.env.TWITTER_CLIENT_ID,
      clientSecret: process.env.TWITTER_CLIENT_SECRET,
    },
    instagram: {
      clientId: process.env.INSTAGRAM_CLIENT_ID,
      clientSecret: process.env.INSTAGRAM_CLIENT_SECRET,
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    },
  },
};

if (config.env === 'production') {
  for (const key of required) {
    const val = process.env[key];
    if (!val || val.startsWith('replace-with') || /^0+$/.test(val)) {
      // warn loudly but keep booting so first-run demos still work
      console.warn(`[config] WARNING: ${key} is not set to a real secret — do not launch publicly like this`);
    }
  }
}

module.exports = config;
