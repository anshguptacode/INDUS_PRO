#!/usr/bin/env node
// Go-live doctor: checks your .env before you flip MOCK_MODE=false.
//   docker compose run --rm backend node scripts/doctor.js
// or locally:  node backend/scripts/doctor.js  (reads process env / ../.env)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// minimal .env loader (no dependency): only fills vars not already set
for (const envPath of [path.join(__dirname, '../../.env'), path.join(__dirname, '../.env')]) {
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
    break;
  }
}

const env = process.env;
let pass = 0, warn = 0, fail = 0;
const ok = (msg) => { pass++; console.log(`  ✔ ${msg}`); };
const wr = (msg) => { warn++; console.log(`  ⚠ ${msg}`); };
const bad = (msg) => { fail++; console.log(`  ✘ ${msg}`); };

console.log('\n── Footprint Pro go-live doctor ──────────────────────────\n');

// 1. secrets
console.log('[1] Secrets');
const weak = (v) => !v || v.includes('replace-with') || v.includes('change-me') || v.length < 32;
weak(env.JWT_SECRET) ? bad('JWT_SECRET is missing/weak — generate a 96-char hex value') : ok('JWT_SECRET looks strong');
weak(env.JWT_REFRESH_SECRET) ? bad('JWT_REFRESH_SECRET is missing/weak') : ok('JWT_REFRESH_SECRET looks strong');
if (env.JWT_SECRET && env.JWT_SECRET === env.JWT_REFRESH_SECRET) bad('JWT_SECRET and JWT_REFRESH_SECRET must differ');
const key = env.TOKEN_ENC_KEY || '';
if (!/^[0-9a-fA-F]{64}$/.test(key)) bad('TOKEN_ENC_KEY must be exactly 64 hex chars (32 bytes)');
else if (/^0+$/.test(key)) bad('TOKEN_ENC_KEY is the all-zero default — real tokens would be trivially decryptable');
else ok('TOKEN_ENC_KEY is a proper 32-byte key');
const pgw = env.PGPASSWORD || '';
if (pgw.includes('change-me') || pgw.length < 12) wr('PGPASSWORD is default/short — fine locally, weak for a public server');
else ok('PGPASSWORD acceptable');

// 2. base URL
console.log('\n[2] Base URL');
const base = env.BASE_URL || 'http://localhost:3000';
if (base.startsWith('https://')) ok(`BASE_URL is HTTPS: ${base}`);
else if (base.includes('localhost')) wr(`BASE_URL is ${base} — fine for local testing; use your HTTPS domain for public launch`);
else bad(`BASE_URL (${base}) is public but not HTTPS — OAuth providers will reject or warn`);

// 3. platforms
console.log('\n[3] Platforms');
const platforms = [
  ['GitHub', env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET, 'github'],
  ['Twitter/X', env.TWITTER_CLIENT_ID, env.TWITTER_CLIENT_SECRET, 'twitter'],
  ['Instagram', env.INSTAGRAM_CLIENT_ID, env.INSTAGRAM_CLIENT_SECRET, 'instagram'],
];
let anyLive = false;
for (const [name, id, secret, slug] of platforms) {
  if (id && secret) {
    anyLive = true;
    ok(`${name}: keys present → will run LIVE`);
    console.log(`      callback to register: ${base}/api/connect/${slug}/callback`);
  } else if (id || secret) {
    bad(`${name}: only one of CLIENT_ID / CLIENT_SECRET is set — both or neither`);
  } else {
    wr(`${name}: no keys → stays in mock mode`);
  }
}

// 4. mode
console.log('\n[4] Mode');
const mock = (env.MOCK_MODE || 'true').toLowerCase() === 'true';
if (mock && anyLive) wr('MOCK_MODE=true overrides your real keys — set MOCK_MODE=false to go live');
else if (mock) wr('MOCK_MODE=true — demo mode (expected until keys are added)');
else if (!anyLive) bad('MOCK_MODE=false but no platform has keys — everything will still fall back to mock');
else ok('MOCK_MODE=false with live keys — production configuration');

console.log(`\n── ${pass} ok, ${warn} warnings, ${fail} problems ──`);
if (fail === 0 && !mock && anyLive) console.log('Ready to launch. Restart with: docker compose up -d --build\n');
else if (fail > 0) { console.log('Fix the ✘ items above, then re-run this doctor.\n'); process.exit(1); }
else console.log('Run again after updating .env.\n');

// bonus: offer fresh secrets when any were weak
if (fail > 0 || warn > 0) {
  console.log('Need fresh secrets? Paste these into .env:');
  console.log(`  JWT_SECRET=${crypto.randomBytes(48).toString('hex')}`);
  console.log(`  JWT_REFRESH_SECRET=${crypto.randomBytes(48).toString('hex')}`);
  console.log(`  TOKEN_ENC_KEY=${crypto.randomBytes(32).toString('hex')}\n`);
}
