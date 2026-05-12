/**
 * Cast End-to-End Test Suite
 * Run: node test-e2e.js (while server is running on port 3001)
 *
 * Tests:
 *  1.  Health check
 *  2.  Signup
 *  3.  GET /me (auth)
 *  4.  Save Claude API key
 *  5.  Deploy endpoint (manual spec)
 *  6.  List endpoints
 *  7.  Get endpoint detail
 *  8.  GET /cast directory
 *  9.  GET /cast/:slug docs
 * 10.  GET /cast/chains info
 * 11.  POST without payment → 402
 * 12.  Test endpoint free (0°C → 32°F)
 * 13.  Test endpoint free (100°C → 212°F)
 * 14.  Test endpoint free (-40°C → -40°F)
 * 15.  Invalid input rejected
 * 16.  Get balance
 * 17.  Get analytics
 * 18.  Pause → verify 404 → reactivate
 * 19.  Conversations list
 * 20.  Withdrawal history
 */

const BASE = 'http://localhost:3001';
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
  // Remove undefined headers
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

// ── Tests ────────────────────────────────────────

async function test01_health() {
  const { status, data } = await req('/health');
  log('Health check', status === 200 && data.status === 'ok', `version ${data.version}`);
}

async function test02_signup() {
  const email = `test-${Date.now()}@cast.dev`;
  const { status, data } = await req('/api/auth/signup', {
    method: 'POST',
    body: { email, password: 'testpassword123' },
  });
  token = data.token;
  log('Signup', status === 201 && !!token, `userId ${data.user?.id?.slice(0, 8)}`);
}

async function test03_me() {
  const { status, data } = await req('/api/auth/me');
  log('GET /me', status === 200 && !!data.email, data.email);
}

async function test04_save_key() {
  const { status, data } = await req('/api/auth/claude-key', {
    method: 'PUT',
    body: { apiKey: 'sk-ant-test-key' },
  });
  log('Save Claude API key', status === 200 && data.success);
}

async function test05_deploy() {
  const code = `async function handler({ input, context }) {
    const c = input.celsius;
    if (typeof c !== 'number') throw new Error('celsius must be a number');
    const fahrenheit = Math.round((c * 9/5 + 32) * 100) / 100;
    return { fahrenheit, celsius: c, formula: "(C × 9/5) + 32", converted_at: context.timestamp };
  }`;

  const { status, data } = await req('/api/endpoints/deploy', {
    method: 'POST',
    body: {
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
  log('Deploy endpoint', status === 201 && !!slug,
    `slug: ${slug}`);
}

async function test06_list() {
  const { status, data } = await req('/api/endpoints');
  log('List endpoints', status === 200 && data.endpoints?.length >= 1,
    `${data.endpoints?.length} endpoints`);
}

async function test07_detail() {
  const { status, data } = await req(`/api/endpoints/${endpointId}`);
  log('Get endpoint detail', status === 200 && data.endpoint?.title === 'Temperature converter',
    data.endpoint?.title);
}

async function test08_directory() {
  const { status, data } = await req('/cast');
  log('GET /cast directory', status === 200 && data.endpoints?.length >= 1,
    `${data.endpoints?.length} public endpoints`);
}

async function test09_docs() {
  const { status, data } = await req(`/cast/${slug}`);
  log('GET /cast/:slug docs', status === 200 && data.title === 'Temperature converter',
    `$${data.pricePerCall}/call`);
}

async function test10_chains() {
  const { status, data } = await req('/cast/chains');
  const hasSolana = data.supported?.some(c => c.chainId === 'solana');
  const hasBase = data.supported?.some(c => c.chainId === 'base');
  log('GET /cast/chains', status === 200 && hasSolana && hasBase,
    `${data.supported?.map(c => c.chainId).join(', ')}`);
}

async function test11_no_payment() {
  // Public call without auth or payment
  const { status, data } = await req(`/cast/${slug}`, {
    method: 'POST',
    body: { celsius: 100 },
    headers: { Authorization: '' },
  });
  const has402 = status === 402;
  const hasChains = Array.isArray(data.x402?.accepts);
  log('POST without payment → 402', has402 && hasChains,
    `accepts ${data.x402?.accepts?.length} chains`);
}

async function test12_test_free_0() {
  const { status, data } = await req(`/api/endpoints/${endpointId}/test`, {
    method: 'POST',
    body: { celsius: 0 },
  });
  log('Test: 0°C → 32°F', status === 200 && data.result?.fahrenheit === 32,
    `${data.result?.fahrenheit}°F in ${data.executionMs}ms`);
}

async function test13_test_free_100() {
  const { status, data } = await req(`/api/endpoints/${endpointId}/test`, {
    method: 'POST',
    body: { celsius: 100 },
  });
  log('Test: 100°C → 212°F', status === 200 && data.result?.fahrenheit === 212,
    `${data.result?.fahrenheit}°F`);
}

async function test14_test_free_neg40() {
  const { status, data } = await req(`/api/endpoints/${endpointId}/test`, {
    method: 'POST',
    body: { celsius: -40 },
  });
  log('Test: -40°C → -40°F (crossover)', status === 200 && data.result?.fahrenheit === -40,
    `${data.result?.fahrenheit}°F`);
}

async function test15_invalid_input() {
  const { status, data } = await req(`/api/endpoints/${endpointId}/test`, {
    method: 'POST',
    body: { celsius: 'hot' },
  });
  log('Invalid input rejected (400)', status === 400, data.error);
}

async function test16_balance() {
  const { status, data } = await req('/api/balance');
  log('Get balance', status === 200 && data.total !== undefined,
    `available: $${data.total?.available?.toFixed(4)} USDC`);
}

async function test17_analytics() {
  const { status, data } = await req(`/api/endpoints/${endpointId}/analytics?days=30`);
  log('Get analytics', status === 200 && Array.isArray(data.dailyCalls),
    `${data.dailyCalls?.length} daily points`);
}

async function test18_pause_reactivate() {
  // Pause
  const { status: s1 } = await req(`/api/endpoints/${endpointId}`, {
    method: 'PUT',
    body: { status: 'paused' },
  });
  log('Pause endpoint', s1 === 200);

  // Paused endpoint should return 404 to callers
  const { status: s2, data: d2 } = await req(`/cast/${slug}`, {
    method: 'POST',
    body: { celsius: 50 },
    headers: { Authorization: '' },
  });
  log('Paused → 404 for callers', s2 === 404, d2.error);

  // Reactivate
  const { status: s3 } = await req(`/api/endpoints/${endpointId}`, {
    method: 'PUT',
    body: { status: 'active' },
  });
  log('Reactivate endpoint', s3 === 200);

  // Verify live again — should get 402 (not 404)
  const { status: s4 } = await req(`/cast/${slug}`, {
    method: 'POST',
    body: { celsius: 50 },
    headers: { Authorization: '' },
  });
  log('Reactivated → 402 again', s4 === 402);
}

async function test19_conversations() {
  const { status, data } = await req('/api/conversations');
  log('Conversations list', status === 200 && Array.isArray(data.conversations),
    `${data.conversations?.length} conversations`);
}

async function test20_withdrawals() {
  const { status, data } = await req('/api/balance/withdrawals');
  log('Withdrawal history', status === 200 && Array.isArray(data.withdrawals),
    `${data.withdrawals?.length} withdrawals`);
}

// ── Extra: duplicate signup should 409 ──
async function test21_duplicate_signup() {
  // Try to signup with same email twice
  const email = `dup-${Date.now()}@cast.dev`;
  await req('/api/auth/signup', { method: 'POST', body: { email, password: 'password123' } });
  const { status } = await req('/api/auth/signup', {
    method: 'POST', body: { email, password: 'different' },
    headers: { Authorization: '' },
  });
  log('Duplicate signup → 409', status === 409);
}

// ── Extra: wrong password should 401 ──
async function test22_wrong_password() {
  const { status } = await req('/api/auth/login', {
    method: 'POST',
    body: { email: 'nobody@cast.dev', password: 'wrongpassword' },
    headers: { Authorization: '' },
  });
  log('Wrong credentials → 401', status === 401);
}

// ── Extra: unauthenticated API access → 401 ──
async function test23_unauth_api() {
  const { status } = await req('/api/endpoints', {
    headers: { Authorization: '' },
  });
  log('Unauthenticated API → 401', status === 401);
}

// ── Run all ──
console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║        Cast End-to-End Test Suite                ║');
console.log('╚══════════════════════════════════════════════════╝\n');

const groups = [
  ['Infrastructure', [test01_health]],
  ['Auth', [test02_signup, test03_me, test04_save_key, test21_duplicate_signup, test22_wrong_password, test23_unauth_api]],
  ['Endpoints', [test05_deploy, test06_list, test07_detail]],
  ['Public API Directory', [test08_directory, test09_docs, test10_chains]],
  ['Payment Gate (x402)', [test11_no_payment]],
  ['Runtime Execution', [test12_test_free_0, test13_test_free_100, test14_test_free_neg40, test15_invalid_input]],
  ['Balance & Analytics', [test16_balance, test17_analytics, test20_withdrawals]],
  ['Lifecycle', [test18_pause_reactivate, test19_conversations]],
];

try {
  for (const [groupName, tests] of groups) {
    console.log(`\n  ─── ${groupName} ${'─'.repeat(38 - groupName.length)}`);
    for (const test of tests) {
      await test();
    }
  }
} catch (err) {
  console.error('\n💥 Test runner crashed:', err.message);
  console.error(err.stack?.split('\n').slice(1, 4).join('\n'));
}

const total = results.passed + results.failed;
const pct = total > 0 ? Math.round((results.passed / total) * 100) : 0;
console.log('\n╔══════════════════════════════════════════════════╗');
console.log(`║  Results: ${results.passed}/${total} passed (${pct}%)${' '.repeat(33 - String(results.passed).length - String(total).length - String(pct).length)}║`);
if (results.failed > 0) {
  console.log('║  Failed tests:' + ' '.repeat(35) + '║');
  results.tests.filter(t => !t.pass).forEach(t => {
    const label = `  ❌  ${t.name}`.slice(0, 50);
    console.log(`║  ${label}${' '.repeat(48 - label.length)}║`);
  });
}
console.log('╚══════════════════════════════════════════════════╝\n');

process.exit(results.failed > 0 ? 1 : 0);
