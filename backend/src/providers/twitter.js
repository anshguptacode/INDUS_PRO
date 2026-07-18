// Twitter / X — OAuth 2.0 with PKCE, API v2.
// Docs: developer.x.com. Free tier: ~100 reads/month — sync sparingly.
const axios = require('axios');
const config = require('../config');
const { apiGet, extractHashtags } = require('./base');

const AUTH_URL = 'https://twitter.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
const API = 'https://api.twitter.com/2';
const SCOPES = 'tweet.read users.read offline.access';

const { clientId, clientSecret } = config.providers.twitter;

module.exports = {
  name: 'twitter',
  usesPkce: true,
  isConfigured: () => Boolean(clientId && clientSecret),

  authUrl({ redirectUri, state, codeChallenge }, creds) {
    const q = new URLSearchParams({
      response_type: 'code', client_id: creds?.clientId || clientId, redirect_uri: redirectUri,
      scope: SCOPES, state, code_challenge: codeChallenge, code_challenge_method: 'S256',
    });
    return `${AUTH_URL}?${q}`;
  },

  async exchangeCode({ code, redirectUri, codeVerifier }, creds) {
    const id = creds?.clientId || clientId;
    const secret = creds?.clientSecret || clientSecret;
    const { data } = await axios.post(TOKEN_URL, new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: redirectUri,
      code_verifier: codeVerifier, client_id: id,
    }), { auth: { username: id, password: secret } });
    return tokenSet(data);
  },

  async refresh(refreshToken, _accessToken, creds) {
    const id = creds?.clientId || clientId;
    const secret = creds?.clientSecret || clientSecret;
    const { data } = await axios.post(TOKEN_URL, new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: refreshToken, client_id: id,
    }), { auth: { username: id, password: secret } });
    return tokenSet(data);
  },

  async fetchProfile(accessToken) {
    const data = await apiGet(`${API}/users/me?user.fields=public_metrics,username`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const u = data.data;
    return {
      providerUserId: u.id,
      handle: `@${u.username}`,
      followers: u.public_metrics?.followers_count ?? 0,
      following: u.public_metrics?.following_count ?? 0,
    };
  },

  // newest-first pages; stop at `sinceId` so incremental syncs stay tiny
  async fetchPosts(accessToken, providerUserId, sinceId) {
    const docs = [];
    let paginationToken;
    for (let page = 0; page < 5; page++) {
      const q = new URLSearchParams({
        max_results: '100',
        'tweet.fields': 'public_metrics,created_at',
        ...(sinceId ? { since_id: sinceId } : {}),
        ...(paginationToken ? { pagination_token: paginationToken } : {}),
      });
      const data = await apiGet(`${API}/users/${providerUserId}/tweets?${q}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      for (const t of data.data || []) {
        const m = t.public_metrics || {};
        docs.push({
          platform: 'twitter',
          external_id: `tw_${t.id}`,
          text: t.text,
          hashtags: extractHashtags(t.text),
          created_at: t.created_at,
          metrics: {
            like_count: m.like_count ?? 0,
            reply_count: m.reply_count ?? 0,
            share_count: (m.retweet_count ?? 0) + (m.quote_count ?? 0),
            impression_count: m.impression_count ?? null,
          },
        });
      }
      paginationToken = data.meta?.next_token;
      if (!paginationToken) break;
    }
    return docs;
  },
};

function tokenSet(data) {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    scopes: data.scope || SCOPES,
  };
}
