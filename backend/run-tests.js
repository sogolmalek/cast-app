/**
 * Cast Test Runner
 * Starts the server and runs the full e2e suite in one process
 */
import { createServer } from 'http';
import app from './src/app.js';
import { migrate } from './src/db.js';
import { readFileSync, unlinkSync } from 'fs';
import { existsSync } from 'fs';

// Clean DB
if (existsSync('./data/cast.db')) {
  try { unlinkSync('./data/cast.db'); } catch {}
}

// Run migrations
migrate();

// Start server on port 3099 (test port)
const PORT = 3099;
const server = createServer(app);
await new Promise(r => server.listen(PORT, r));
console.log(`\n[Test server] Listening on port ${PORT}\n`);

// Monkey-patch BASE URL in test
const BASE = `http://localhost:${PORT}`;
let token = '';
let endpointId = '';
let slug = '';
const results = { passed: 0, failed: 0, tests: [] };

function log(name, pass, detail = '') {
  const icon = pass ? '✅' : '❌';
  results.tests.push({ name, pass, detail });
  if (pass) results.passed++; else results.failed++;
  console.log(`  ${icon} ${name}${detail ? `  ·  ${detail}` : ''}`);
}

async function req(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };
  Object.keys(headers).forEach(k => headers[k] === undefined && delete headers[k]);
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, data };
}

// ── Tests ──

async function t01() {
  const { status, data } = await req('/health');
  log('Health check', status === 200 && data.status === 'ok', `v${data.version}`);
}

async function t02() {
  const email = `test-${Date.now()}@cast.dev`;
  const { status, data } = await req('/api/auth/signup', {
    method: 'POST', body: { email, password: 'testpassword123' },
  });
  token = data.token;
  log('Signup', status === 201 && !!token, `userId: ${data.user?.id?.slice(0, 8)}`);
}

async function t03() {
  const { status, data } = await req('/api/auth/me');
  log('GET /me (auth check)', status === 200 && !!data.email, data.email);
}

async function t04() {
  const { status, data } = await req('/api/auth/claude-key', {
    method: 'PUT', body: { apiKey: 'sk-ant-test-key' },
  });
  log('Save Claude API key', status === 200 && data.success);
}

async function t05() {
  const code = `async function handler({ input, context }) {
    const c = input.celsius;
    if (typeof c !== 'number') throw new Error('celsius must be a number');
    const fahrenheit = Math.round((c * 9/5 + 32) * 100) / 100;
    return { fahrenheit, celsius: c, formula: "(C × 9/5) + 32", converted_at: context.timestamp };
  }`;
  const { status, data } = await req('/api/endpoints/deploy', {
    method: 'POST', body: {
      title: 'Temperature converter',
      description: 'Converts Celsius to Fahrenheit',
      prompt: 'An API that converts celsius to fahrenheit',
      code,
      inputSchema: { celsius: { type: 'number', required: true, description: 'Temperature in Celsius' } },
      outputSchema: { fahrenheit: { type: 'number', description: 'Temperature in Fahrenheit' } },
      pricePerCall: 0.001,
    },
  });
  endpointId = data.endpoint?.id;
  slug = data.endpoint?.slug;
  log('Deploy endpoint', status === 201 && !!slug, `slug: ${slug}`);
}

async function t06() {
  const { status, data } = await req('/api/endpoints');
  log('List endpoints', status === 200 && data.endpoints?.length >= 1,
    `${data.endpoints?.length} found`);
}

async function t07() {
  const { status, data } = await req(`/api/endpoints/${endpointId}`);
  log('Endpoint detail', status === 200 && data.endpoint?.title === 'Temperature converter',
    data.endpoint?.title);
}

async function t08() {
  const { status, data } = await req('/cast');
  log('GET /cast directory', status === 200 && data.endpoints?.length >= 1,
    `${data.endpoints?.length} public endpoints`);
}

async function t09() {
  const { status, data } = await req(`/cast/${slug}`);
  log('GET /cast/:slug docs', status === 200 && data.title === 'Temperature converter',
    `$${data.pricePerCall}/call`);
}

async function t10() {
  const { status, data } = await req('/cast/chains');
  const hasStarknet = data.supported?.some(c => c.chainId === 'starknet');
  const hasBase = data.supported?.some(c => c.chainId === 'base');
  log('GET /cast/chains', status === 200 && hasStarknet && hasBase,
    data.supported?.map(c => c.chainId).join(', '));
}

async function t11() {
  const { status, data } = await req(`/cast/${slug}`, {
    method: 'POST', body: { celsius: 100 },
    headers: { Authorization: '' },
  });
  log('POST without payment → 402', status === 402 && !!data.x402,
    `accepts ${data.x402?.accepts?.length} chains`);
}

async function t12() {
  const { status, data } = await req(`/api/endpoints/${endpointId}/test`, {
    method: 'POST', body: { celsius: 0 },
  });
  log('Test: 0°C → 32°F', status === 200 && data.result?.fahrenheit === 32,
    `${data.result?.fahrenheit}°F in ${data.executionMs}ms`);
}

async function t13() {
  const { status, data } = await req(`/api/endpoints/${endpointId}/test`, {
    method: 'POST', body: { celsius: 100 },
  });
  log('Test: 100°C → 212°F', status === 200 && data.result?.fahrenheit === 212,
    `${data.result?.fahrenheit}°F`);
}

async function t14() {
  const { status, data } = await req(`/api/endpoints/${endpointId}/test`, {
    method: 'POST', body: { celsius: -40 },
  });
  log('Test: -40°C = -40°F (crossover)', status === 200 && data.result?.fahrenheit === -40,
    `${data.result?.fahrenheit}°F`);
}

async function t15() {
  const { status, data } = await req(`/api/endpoints/${endpointId}/test`, {
    method: 'POST', body: { celsius: 'hot' },
  });
  log('Invalid input → 400', status === 400, data.error);
}

async function t16() {
  const { status, data } = await req('/api/balance');
  log('Get balance', status === 200 && data.total !== undefined,
    `$${data.total?.available?.toFixed(4)} USDC available`);
}

async function t17() {
  const { status, data } = await req(`/api/endpoints/${endpointId}/analytics?days=30`);
  log('Get analytics', status === 200 && Array.isArray(data.dailyCalls),
    `${data.dailyCalls?.length} daily points`);
}

async function t18() {
  // Pause
  const { status: s1 } = await req(`/api/endpoints/${endpointId}`, {
    method: 'PUT', body: { status: 'paused' },
  });
  log('Pause endpoint', s1 === 200);

  // Paused → 404
  const { status: s2, data: d2 } = await req(`/cast/${slug}`, {
    method: 'POST', body: { celsius: 50 },
    headers: { Authorization: '' },
  });
  log('Paused endpoint → 404', s2 === 404, d2.error);

  // Reactivate
  const { status: s3 } = await req(`/api/endpoints/${endpointId}`, {
    method: 'PUT', body: { status: 'active' },
  });
  log('Reactivate endpoint', s3 === 200);

  // Back to 402
  const { status: s4 } = await req(`/cast/${slug}`, {
    method: 'POST', body: { celsius: 50 },
    headers: { Authorization: '' },
  });
  log('Reactivated → 402 again', s4 === 402);
}

async function t19() {
  const { status, data } = await req('/api/conversations');
  log('Conversations list', status === 200 && Array.isArray(data.conversations),
    `${data.conversations?.length} conversations`);
}

async function t20() {
  const { status, data } = await req('/api/balance/withdrawals');
  log('Withdrawal history', status === 200 && Array.isArray(data.withdrawals),
    `${data.withdrawals?.length} withdrawals`);
}

async function t21() {
  const email = `dup-${Date.now()}@cast.dev`;
  await req('/api/auth/signup', {
    method: 'POST', body: { email, password: 'password123' },
    headers: { Authorization: '' },
  });
  const { status } = await req('/api/auth/signup', {
    method: 'POST', body: { email, password: 'different' },
    headers: { Authorization: '' },
  });
  log('Duplicate signup → 409', status === 409);
}

async function t22() {
  const { status } = await req('/api/auth/login', {
    method: 'POST', body: { email: 'nobody@cast.dev', password: 'wrong' },
    headers: { Authorization: '' },
  });
  log('Wrong credentials → 401', status === 401);
}

async function t23() {
  const { status } = await req('/api/endpoints', {
    headers: { Authorization: 'Bearer invalid-token' },
  });
  log('Invalid token → 401', status === 401);
}

async function t24() {
  // Update price
  const { status } = await req(`/api/endpoints/${endpointId}`, {
    method: 'PUT', body: { pricePerCall: 0.005 },
  });
  log('Update endpoint price', status === 200);
}

async function t25() {
  // Starknet typed data endpoint
  const { status, data } = await req(`/cast/chains/starknet/typed-data/${slug}`);
  log('Starknet typed-data template', status === 200 && !!data.typedData,
    data.typedData?.primaryType);
}

// ── Run ──

console.log('╔══════════════════════════════════════════════════╗');
console.log('║        Cast End-to-End Test Suite                ║');
console.log('╚══════════════════════════════════════════════════╝');

const groups = [
  ['Infrastructure',     [t01]],
  ['Auth',               [t02, t03, t04, t21, t22, t23]],
  ['Endpoint Lifecycle', [t05, t06, t07, t24]],
  ['Public API',         [t08, t09, t10]],
  ['x402 Payment Gate',  [t11]],
  ['Runtime Execution',  [t12, t13, t14, t15]],
  ['Balance & Earnings', [t16, t17, t20]],
  ['Pause / Reactivate', [t18]],
  ['Starknet',           [t25]],
  ['Misc',               [t19]],
];

let crashed = false;
for (const [groupName, tests] of groups) {
  console.log(`\n  ── ${groupName} ${'─'.repeat(44 - groupName.length)}`);
  for (const test of tests) {
    try {
      await test();
    } catch (err) {
      log(test.name, false, `THREW: ${err.message}`);
    }
  }
}

const total = results.passed + results.failed;
const pct = total > 0 ? Math.round((results.passed / total) * 100) : 0;

console.log('\n╔══════════════════════════════════════════════════╗');
console.log(`║  ${results.passed}/${total} passed  (${pct}%)${' '.repeat(39 - String(results.passed).length - String(total).length - String(pct).length)}║`);
if (results.failed > 0) {
  console.log('╠══════════════════════════════════════════════════╣');
  results.tests.filter(t => !t.pass).forEach(t => {
    const line = `  ❌  ${t.name}`;
    console.log(`║${line}${' '.repeat(50 - line.length)}║`);
  });
}
console.log('╚══════════════════════════════════════════════════╝\n');

server.close();
process.exit(results.failed > 0 ? 1 : 0);
