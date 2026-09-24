/**
 * Test Suite: Network Interceptor
 * Verifies fetch & XMLHttpRequest interception, header masking,
 * duration tracking, and large payload blob dumping.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Running test-network-interceptor.js ---');

const eventsEmitted = [];
const blobsEmitted = [];

global.window = global;
global.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
global.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');
global.unescape = unescape;
global.crypto = {
  randomUUID: () => 'test-uuid-1234'
};

// Define mock fetch BEFORE loading interceptor so originalFetch captures mock
let currentMockResponse = null;
global.fetch = async (url, options = {}) => {
  return currentMockResponse(url, options);
};

// Load interceptor
const interceptorCode = fs.readFileSync(path.join(__dirname, '../content/network-interceptor.js'), 'utf8');
eval(interceptorCode);

assert(global.__rrwebNetworkRecorder, '__rrwebNetworkRecorder should be exposed');

// Start recording
global.__rrwebNetworkRecorder.start(
  (ev) => eventsEmitted.push(ev),
  (blob) => blobsEmitted.push(blob),
  { maxBodySize: 1024, maskAuth: true }
);

(async () => {
  // Test 1: Fetch interception with sensitive headers
  currentMockResponse = async () => ({
    status: 200,
    statusText: 'OK',
    headers: new Headers([
      ['content-type', 'application/json'],
      ['set-cookie', 'secret_session_id=abcdef12345'],
      ['x-request-id', 'req-999']
    ]),
    clone: function () {
      return {
        text: async () => JSON.stringify({ success: true, user: 'tester' })
      };
    }
  });

  const res = await global.fetch('https://api.example.com/v1/auth/login', {
    method: 'POST',
    headers: {
      'authorization': 'Bearer supersecrettoken',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ username: 'alice' })
  });

  assert.strictEqual(res.status, 200);

  // Wait a microtask for promise resolution in interceptor
  await new Promise((r) => setTimeout(r, 25));

  assert.strictEqual(eventsEmitted.length, 1, 'Should have emitted 1 network event');
  const netEv = eventsEmitted[0];
  assert.strictEqual(netEv.type, 5, 'Should be custom event (type 5)');
  assert.strictEqual(netEv.data.tag, 'network', 'Tag should be network');

  const p = netEv.data.payload;
  assert.strictEqual(p.method, 'POST');
  assert.strictEqual(p.url, 'https://api.example.com/v1/auth/login');
  assert.strictEqual(p.status, 200);
  assert.strictEqual(p.requestHeaders['authorization'], '[REDACTED]', 'Sensitive auth header must be masked');
  assert.strictEqual(p.responseHeaders['set-cookie'], '[REDACTED]', 'Sensitive set-cookie header must be masked');
  assert.strictEqual(p.responseHeaders['x-request-id'], 'req-999', 'Non-sensitive header should be preserved');
  assert.strictEqual(p.responseBody, JSON.stringify({ success: true, user: 'tester' }));
  console.log('✓ Test 1 Passed: fetch request/response interception & auth masking');

  // Test 2: Large response payload dumping to blob
  currentMockResponse = async () => ({
    status: 200,
    statusText: 'OK',
    headers: new Headers([['content-type', 'text/plain']]),
    clone: () => ({
      text: async () => 'X'.repeat(5000) // exceeds maxBodySize: 1024
    })
  });

  await global.fetch('https://api.example.com/v1/data/large-export');
  await new Promise((r) => setTimeout(r, 25));

  assert.strictEqual(eventsEmitted.length, 2, 'Should have emitted second network event');
  const largeEv = eventsEmitted[1].data.payload;
  assert(largeEv.responseBody.truncated, 'Large response should be marked truncated');
  assert(largeEv.responseBody.blobId, 'Large response should have blobId');
  assert.strictEqual(blobsEmitted.length, 1, 'Should have emitted 1 blob dump');
  assert.strictEqual(blobsEmitted[0].blobId, largeEv.responseBody.blobId);
  console.log('✓ Test 2 Passed: large response cut-off and blob dump');

  // Test 3: Beacon interception
  if (!global.navigator) global.navigator = {};
  Object.defineProperty(global.navigator, 'sendBeacon', {
    value: (url, data) => true,
    writable: true,
    configurable: true
  });
  global.__rrwebNetworkRecorder.start(
    (ev) => eventsEmitted.push(ev),
    (blob) => blobsEmitted.push(blob),
    { maxBodySize: 1024, maskAuth: true }
  );
  global.navigator.sendBeacon('https://api.example.com/telemetry', JSON.stringify({ ping: 'pong' }));
  assert.strictEqual(eventsEmitted.length, 3, 'Should have emitted beacon network event');
  const beaconEv = eventsEmitted[2].data.payload;
  assert.strictEqual(beaconEv.initiator, 'beacon');
  assert.strictEqual(beaconEv.url, 'https://api.example.com/telemetry');
  console.log('✓ Test 3 Passed: navigator.sendBeacon interception');

  global.__rrwebNetworkRecorder.stop();

  // Test 4: Console Telemetry Interceptor
  assert(global.__rrwebConsoleRecorder, '__rrwebConsoleRecorder should be exposed');
  const consoleEvents = [];
  global.__rrwebConsoleRecorder.start((ev) => consoleEvents.push(ev));

  console.log('Hello from test log', { user: 'Alice', count: 42 });
  console.warn('Warning: resource deprecated');
  console.error(new Error('Sample test failure'));

  assert.strictEqual(consoleEvents.length, 3, 'Should have emitted 3 console events');
  assert.strictEqual(consoleEvents[0].data.tag, 'console');
  assert.strictEqual(consoleEvents[0].data.payload.level, 'log');
  assert.strictEqual(consoleEvents[0].data.payload.args[0], 'Hello from test log');
  assert.strictEqual(consoleEvents[0].data.payload.args[1].user, 'Alice');

  assert.strictEqual(consoleEvents[1].data.payload.level, 'warn');
  assert.strictEqual(consoleEvents[1].data.payload.args[0], 'Warning: resource deprecated');

  assert.strictEqual(consoleEvents[2].data.payload.level, 'error');
  assert(consoleEvents[2].data.payload.args[0].__isError, 'Error arg should be serialized as error');
  assert.strictEqual(consoleEvents[2].data.payload.args[0].message, 'Sample test failure');
  console.log('✓ Test 4 Passed: console.log, warn, error telemetry capture & serialization');

  global.__rrwebConsoleRecorder.stop();
  console.log('All Network & Telemetry Interceptor tests passed successfully!\n');
})();
