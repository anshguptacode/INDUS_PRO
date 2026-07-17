// Instagram via Meta Graph API (requires Business/Creator account linked
// to a Facebook Page; app must have instagram_basic + pages_show_list).
const axios = require('axios');
const config = require('../config');
const { apiGet, extractHashtags } = require('./base');

const GRAPH = 'https://graph.facebook.com/v21.0';
const SCOPES = 'instagram_basic,pages_show_list,instagram_manage_insights';

const { clientId, clientSecret } = config.providers.instagram;

module.exports = {
  name: 'instagram',
  usesPkce: false,
  isConfigured: () => Boolean(clientId && clientSecret),

  authUrl({ redirectUri, state }) {
    const q = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, scope: SCOPES,
      response_type: 'code', state,
    });
    return `https://www.facebook.com/v21.0/dialog/oauth?${q}`;
  },

  async exchangeCode({ code, redirectUri }) {
    // short-lived code -> user token -> long-lived token (~60 days)
    const shortTok = await apiGet(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, code,
    }));
    const longTok = await apiGet(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
      grant_type: 'fb_exchange_token', client_id: clientId,
      client_secret: clientSecret, fb_exchange_token: shortTok.access_token,
    }));
    return {
      accessToken: longTok.access_token,
      refreshToken: null, // long-lived FB tokens are re-exchanged, not refreshed
      expiresAt: new Date(Date.now() + (longTok.expires_in || 60 * 86400) * 1000),
      scopes: SCOPES,
    };
  },

  async refresh(_ignored, accessToken) {
    // re-exchange the still-valid long-lived token for a fresh one
    const longTok = await apiGet(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
      grant_type: 'fb_exchange_token', client_id: clientId,
      client_secret: clientSecret, fb_exchange_token: accessToken,
    }));
    return {
      accessToken: longTok.access_token,
      refreshToken: null,
      expiresAt: new Date(Date.now() + (longTok.expires_in || 60 * 86400) * 1000),
      scopes: SCOPES,
    };
  },

  async fetchProfile(accessToken) {
    const igUserId = await resolveIgUser(accessToken);
    const u = await apiGet(`${GRAPH}/${igUserId}?` + new URLSearchParams({
      fields: 'username,followers_count,follows_count', access_token: accessToken,
    }));
    return {
      providerUserId: igUserId,
      handle: u.username,
      followers: u.followers_count ?? 0,
      following: u.follows_count ?? 0,
    };
  },

  async fetchPosts(accessToken, providerUserId) {
    const docs = [];
    let url = `${GRAPH}/${providerUserId}/media?` + new URLSearchParams({
      fields: 'caption,like_count,comments_count,timestamp,media_type',
      limit: '100', access_token: accessToken,
    });
    for (let page = 0; page < 5 && url; page++) {
      const data = await apiGet(url);
      for (const m of data.data || []) {
        docs.push({
          platform: 'instagram',
          external_id: `ig_${m.id}`,
          text: m.caption || `(${(m.media_type || 'media').toLowerCase()})`,
          hashtags: extractHashtags(m.caption),
          created_at: m.timestamp,
          metrics: {
            like_count: m.like_count ?? 0,
            reply_count: m.comments_count ?? 0,
            share_count: 0,
            impression_count: null, // needs instagram_manage_insights per-media call
          },
        });
      }
      url = data.paging?.next || null;
    }
    return docs;
  },
};

// user token -> first FB Page -> its linked IG business account
async function resolveIgUser(accessToken) {
  const pages = await apiGet(`${GRAPH}/me/accounts?access_token=${accessToken}`);
  for (const page of pages.data || []) {
    const detail = await apiGet(`${GRAPH}/${page.id}?` + new URLSearchParams({
      fields: 'instagram_business_account', access_token: accessToken,
    }));
    if (detail.instagram_business_account) return detail.instagram_business_account.id;
  }
  throw new Error('no Instagram Business account linked to your Facebook Pages');
}
