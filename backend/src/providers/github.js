// GitHub — free API, instant keys. Repos are treated as "posts":
// stars = likes, forks = shares, open issues = comments.
const axios = require('axios');
const config = require('../config');
const { apiGet } = require('./base');

const { clientId, clientSecret } = config.providers.github;

module.exports = {
  name: 'github',
  usesPkce: false,
  isConfigured: () => Boolean(clientId && clientSecret),

  authUrl({ redirectUri, state }) {
    const q = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, scope: 'read:user', state,
    });
    return `https://github.com/login/oauth/authorize?${q}`;
  },

  async exchangeCode({ code, redirectUri }) {
    const { data } = await axios.post('https://github.com/login/oauth/access_token',
      { client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri },
      { headers: { Accept: 'application/json' } });
    if (data.error) throw new Error(data.error_description || data.error);
    return { accessToken: data.access_token, refreshToken: null, expiresAt: null, scopes: data.scope };
  },

  async refresh() { throw new Error('github tokens do not expire'); },

  async fetchProfile(accessToken) {
    const u = await apiGet('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return {
      providerUserId: String(u.id),
      handle: u.login,
      followers: u.followers ?? 0,
      following: u.following ?? 0,
    };
  },

  async fetchPosts(accessToken) {
    const repos = await apiGet('https://api.github.com/user/repos?sort=created&per_page=100&type=owner', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return (repos || []).filter((r) => !r.private).map((r) => ({
      platform: 'github',
      external_id: `gh_${r.id}`,
      text: `${r.name}${r.description ? ` — ${r.description}` : ''}`,
      hashtags: [r.language].filter(Boolean),
      created_at: r.created_at,
      metrics: {
        like_count: r.stargazers_count ?? 0,
        reply_count: r.open_issues_count ?? 0,
        share_count: r.forks_count ?? 0,
        impression_count: null,
      },
    }));
  },
};
