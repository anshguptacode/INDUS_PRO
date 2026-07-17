// Mock provider — realistic demo data with discoverable patterns, no keys
// needed. Each sync also emits a few "new" posts so the real-time loop is
// visible in the dashboard. Deterministic per handle.
const crypto = require('crypto');
const { extractHashtags } = require('./base');

const TOPICS = {
  gate_prep: { mult: 3.0, tags: ['GATE2026', 'GATECSE'], tone: [0.75, 0.15, 0.10] },
  dsa: { mult: 2.8, tags: ['DSA', 'LeetCode'], tone: [0.70, 0.20, 0.10] },
  project: { mult: 2.2, tags: ['buildinpublic', 'SideProject'], tone: [0.80, 0.15, 0.05] },
  react: { mult: 1.6, tags: ['ReactJS', 'webdev'], tone: [0.65, 0.25, 0.10] },
  ai_ml: { mult: 1.8, tags: ['MachineLearning', 'AI'], tone: [0.70, 0.20, 0.10] },
  personal: { mult: 0.9, tags: ['college'], tone: [0.55, 0.25, 0.20] },
  bug_rant: { mult: 0.6, tags: ['debugging'], tone: [0.05, 0.15, 0.80] },
};
const TEMPLATES = {
  positive: [
    'Just shipped: {t} 🚀 one of the most fun things I have built. #{tag}',
    'Big milestone — finished my {t} deep dive. Sharing everything free. #{tag}',
    '30 days of {t} done ✅ progress compounds. #{tag}',
    'Cracked a hard {t} problem. The trick nobody mentions: #{tag}',
  ],
  neutral: [
    'New blog post: a practical intro to {t}. #{tag}',
    'Resource dump — everything I use for {t}. #{tag}',
    'Weekly roundup: what is new in {t}. #{tag}',
  ],
  negative: [
    '4 hours lost to a {t} bug that was a missing comma 😤 #{tag}',
    'Failed my {t} mock test today. Not the update I wanted. #{tag}',
  ],
};
const HUMAN = { gate_prep: 'GATE prep', dsa: 'DSA', project: 'my side project', react: 'React.js', ai_ml: 'ML', personal: 'college life', bug_rant: 'Django' };

// deterministic PRNG so the same account always has the same history
function rng(seedStr) {
  let s = parseInt(crypto.createHash('md5').update(seedStr).digest('hex').slice(0, 8), 16);
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}
const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];
const weighted = (rand, weights) => {
  const r = rand() * weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < weights.length; i++) { acc += weights[i]; if (r <= acc) return i; }
  return 0;
};

function makePost(rand, platform, when, seq) {
  const topics = Object.keys(TOPICS);
  const topic = topics[weighted(rand, [14, 13, 10, 12, 10, 16, 8])];
  const t = TOPICS[topic];
  const tone = ['positive', 'neutral', 'negative'][weighted(rand, t.tone)];
  const text = pick(rand, TEMPLATES[tone])
    .replace('{t}', HUMAN[topic]).replace('{tag}', pick(rand, t.tags));

  // Tue/Thu 18-20 IST boost + topic multiplier + engagement growth over time
  const dow = when.getUTCDay();
  const hourIst = (when.getUTCHours() + 5.5) % 24;
  let mult = t.mult * (dow === 2 || dow === 4 ? 1.6 : 1.0)
    * (hourIst >= 18 && hourIst < 20 ? 1.5 : 1.0)
    * (0.5 + rand());
  const ageFrac = Math.max(0, Math.min(1, (Date.now() - when.getTime()) / (365 * 86400e3)));
  const impressions = Math.max(60, Math.round(1800 * mult * (1 - 0.4 * ageFrac)));
  const likes = Math.round(impressions * 0.02 * (2 - ageFrac) * (0.8 + 0.4 * rand()));
  return {
    platform,
    external_id: `${platform.slice(0, 2)}_mock_${when.getTime()}_${seq}`,
    text,
    hashtags: extractHashtags(text),
    created_at: when.toISOString(),
    metrics: {
      like_count: likes,
      reply_count: Math.round(likes * 0.12),
      share_count: Math.round(likes * 0.2),
      impression_count: impressions,
    },
  };
}

module.exports = {
  name: 'mock',
  usesPkce: false,
  isConfigured: () => true,
  authUrl: () => null, // no OAuth hop — connect route creates the account directly

  async exchangeCode() {
    return { accessToken: 'mock-token', refreshToken: null, expiresAt: null, scopes: 'mock' };
  },
  async refresh() {
    return { accessToken: 'mock-token', refreshToken: null, expiresAt: null, scopes: 'mock' };
  },

  async fetchProfile(_token, seedHandle = 'demo') {
    const rand = rng(`${seedHandle}:profile:${new Date().toDateString()}`);
    // followers drift upward a little every day
    const days = Math.floor(Date.now() / 86400e3) % 10000;
    return {
      providerUserId: `mock_${seedHandle}`,
      handle: `${seedHandle}_demo`,
      followers: 9000 + Math.round(days * 1.7 + rand() * 40),
      following: 420,
    };
  },

  // first sync: a year of history; later syncs: only fresh posts
  async fetchPosts(_token, providerUserId, sinceId, platformLabel = 'mock') {
    const rand = rng(`${providerUserId}:posts`);
    const docs = [];
    if (!sinceId) {
      const now = Date.now();
      for (let i = 0; i < 320; i++) {
        const when = new Date(now - Math.floor(rand() * 360 + 1) * 86400e3
          - Math.floor(rand() * 86400e3));
        docs.push(makePost(rand, platformLabel, when, i));
      }
    }
    // 1-3 "new" posts in the last few hours — makes real-time sync visible
    const fresh = rng(`${providerUserId}:${Math.floor(Date.now() / 3.6e6)}`); // changes hourly
    const nFresh = 1 + Math.floor(fresh() * 3);
    for (let i = 0; i < nFresh; i++) {
      const when = new Date(Date.now() - Math.floor(fresh() * 4 * 3.6e6));
      docs.push(makePost(fresh, platformLabel, when, 9000 + i));
    }
    return docs;
  },
};
