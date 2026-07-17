const { MongoClient } = require('mongodb');
const config = require('./config');

let client;

async function rawPosts() {
  if (!client) {
    client = new MongoClient(config.mongoUrl, { maxPoolSize: 10 });
    await client.connect();
    // idempotent index: one doc per platform post, fast account scans
    await client.db('footprint').collection('raw_posts')
      .createIndex({ platform: 1, external_id: 1 }, { unique: true });
    await client.db('footprint').collection('raw_posts')
      .createIndex({ account_id: 1 });
  }
  return client.db('footprint').collection('raw_posts');
}

module.exports = { rawPosts };
