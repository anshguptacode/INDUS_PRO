// Provider registry. In MOCK_MODE (or when a platform has no keys), the
// mock provider stands in — but keeps the requested platform label so the
// rest of the pipeline behaves identically to production.
const config = require('../config');
const twitter = require('./twitter');
const instagram = require('./instagram');
const github = require('./github');
const mock = require('./mock');

const REAL = { twitter, instagram, github };
const PLATFORMS = ['twitter', 'instagram', 'github'];

function getProvider(platform) {
  if (!PLATFORMS.includes(platform) && platform !== 'mock') {
    throw new Error(`unknown platform: ${platform}`);
  }
  const real = REAL[platform];
  if (!config.mockMode && real?.isConfigured()) return { provider: real, isMock: false };
  return { provider: mock, isMock: true };
}

function platformStatus() {
  return PLATFORMS.map((p) => ({
    platform: p,
    configured: REAL[p].isConfigured(),
    mode: config.mockMode || !REAL[p].isConfigured() ? 'mock' : 'live',
  }));
}

module.exports = { getProvider, platformStatus, PLATFORMS };
