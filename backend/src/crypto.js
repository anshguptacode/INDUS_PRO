// AES-256-GCM vault for OAuth tokens — ciphertext format: iv:tag:data (hex)
const crypto = require('crypto');
const config = require('./config');

const KEY = Buffer.from(config.tokenEncKey, 'hex');

function encrypt(plaintext) {
  if (!plaintext) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${data.toString('hex')}`;
}

function decrypt(ciphertext) {
  if (!ciphertext) return null;
  const [iv, tag, data] = ciphertext.split(':').map((h) => Buffer.from(h, 'hex'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

module.exports = { encrypt, decrypt, sha256 };
