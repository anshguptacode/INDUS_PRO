// Shared helpers for platform providers.
const axios = require('axios');

class RateLimitError extends Error {
  constructor(retryAfterMs) {
    super(`rate limited, retry in ${Math.round(retryAfterMs / 1000)}s`);
    this.retryAfterMs = retryAfterMs;
  }
}

// GET with 429 handling — throws RateLimitError so the worker can
// re-schedule the job instead of hammering the API.
async function apiGet(url, opts = {}) {
  try {
    const { data } = await axios.get(url, { timeout: 20000, ...opts });
    return data;
  } catch (e) {
    const res = e.response;
    if (res?.status === 429) {
      const reset = +res.headers['x-rate-limit-reset']; // twitter: epoch seconds
      const retryAfter = +res.headers['retry-after'];   // generic: seconds
      const ms = reset ? Math.max(reset * 1000 - Date.now(), 60000)
        : retryAfter ? retryAfter * 1000 : 15 * 60000;
      throw new RateLimitError(ms);
    }
    throw e;
  }
}

const extractHashtags = (text) =>
  [...(text || '').matchAll(/#(\w+)/g)].map((m) => m[1]);

module.exports = { apiGet, RateLimitError, extractHashtags };
