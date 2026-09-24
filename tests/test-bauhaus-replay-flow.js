const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');

(async () => {
  const extensionPath = path.resolve(__dirname, '..');
  const tmpUserDataDir = path.join(os.tmpdir(), 'webicu-bauhaus-flow-' + Date.now());
  fs.mkdirSync(tmpUserDataDir, { recursive: true });
  const CHROMIUM_PATH = 'C:\\Users\\LOLBIT\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe';

  console.log('Launching browser with extension from:', extensionPath);
  const context = await chromium.launchPersistentContext(tmpUserDataDir, {
    executablePath: CHROMIUM_PATH,
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  console.log('Waiting for background service worker...');
  let sw = context.serviceWorkers()[0];
  if (!sw) {
    try {
      sw = await context.waitForEvent('serviceworker', { timeout: 10000 });
    } catch (e) {
      sw = context.serviceWorkers()[0];
    }
  }

  const extensionId = sw.url().split('/')[2];
  console.log('Detected Extension ID:', extensionId);

  const page = await context.newPage();
  page.on('console', msg => console.log('[Browser]:', msg.text()));
  page.on('pageerror', err => console.error('[Page Error]:', err));

  // 1. Navigate to Workbench Tab 01
  await page.goto(`chrome-extension://${extensionId}/pages/index.html#/sessions`);
  await page.waitForTimeout(1000);

  // 2. Inject a high-fidelity test session with DOM events and HAR entries directly into IndexedDB
  console.log('Injecting sample Bauhaus test session into IndexedDB...');
  await page.evaluate(async () => {
    const { getSessionsDb, getEventsDb } = await import('./index.js');
    const sDb = await getSessionsDb();
    const eDb = await getEventsDb();

    const sessionId = 'bauhaus_demo_09';
    const now = Date.now();

    const sampleHar = {
      log: {
        version: '1.2',
        creator: { name: 'WebICU / rrweb Chrome Native Capturer', version: '2.1.6' },
        pages: [{ startedDateTime: new Date(now).toISOString(), id: 'page_1', title: 'Fintech Enterprise Invoice', pageTimings: {} }],
        entries: [
          {
            startedDateTime: new Date(now + 200).toISOString(),
            time: 244.18,
            request: {
              method: 'POST',
              url: 'https://app.fintechcore.io/api/v1/client_session.json',
              httpVersion: 'http/2.0',
              headers: [
                { name: 'content-type', value: 'application/json' },
                { name: 'accept', value: 'application/json' }
              ],
              queryString: [],
              cookies: [],
              headersSize: 180,
              bodySize: 42,
              postData: { mimeType: 'application/json', text: '{"tenant":"fintech_core.v2","env":"prod"}' }
            },
            response: {
              status: 200,
              statusText: 'OK',
              httpVersion: 'http/2.0',
              headers: [
                { name: 'content-type', value: 'application/json; charset=utf-8' },
                { name: 'x-cluster-node', value: 'cluster-fra-04' }
              ],
              cookies: [],
              content: { size: 2450, mimeType: 'application/json', text: '{"status":"active","session":"#0x9F1A-B4","authenticated":true}' },
              redirectURL: '',
              headersSize: 220,
              bodySize: 2450,
              _transferSize: 2450
            },
            serverIPAddress: '104.21.88.19',
            _resourceType: 'fetch'
          },
          {
            startedDateTime: new Date(now + 1200).toISOString(),
            time: 185.4,
            request: {
              method: 'GET',
              url: 'https://app.fintechcore.io/api/v1/auth/verify',
              httpVersion: 'http/2.0',
              headers: [
                { name: 'authorization', value: 'Bearer token-expired-xyz' }
              ],
              queryString: [],
              cookies: [],
              headersSize: 150,
              bodySize: 0
            },
            response: {
              status: 403,
              statusText: 'Forbidden',
              httpVersion: 'http/2.0',
              headers: [
                { name: 'content-type', value: 'application/json; charset=utf-8' },
                { name: 'x-auth-challenge', value: 'FAILED_SIGNATURE_EXPIRED' }
              ],
              cookies: [],
              content: {
                size: 412,
                mimeType: 'application/json',
                text: JSON.stringify({
                  error: {
                    code: 'TOKEN_INVALID',
                    message: 'Token verification rejected at edge router.',
                    timestamp: now + 1200,
                    retryable: false
                  }
                })
              },
              redirectURL: '',
              headersSize: 210,
              bodySize: 412,
              _transferSize: 412
            },
            serverIPAddress: '104.21.88.19',
            _resourceType: 'fetch'
          },
          {
            startedDateTime: new Date(now + 2800).toISOString(),
            time: 89.2,
            request: {
              method: 'GET',
              url: 'https://app.fintechcore.io/manifest.webmanifest',
              httpVersion: 'http/2.0',
              headers: [],
              queryString: [],
              cookies: [],
              headersSize: 90,
              bodySize: 0
            },
            response: {
              status: 304,
              statusText: 'Not Modified',
              httpVersion: 'http/2.0',
              headers: [],
              cookies: [],
              content: { size: 0, mimeType: 'application/manifest+json' },
              redirectURL: '',
              headersSize: 120,
              bodySize: 0,
              _transferSize: 0
            },
            serverIPAddress: '104.21.88.19',
            _resourceType: 'fetch'
          },
          {
            startedDateTime: new Date(now + 4100).toISOString(),
            time: 420.0,
            request: {
              method: 'POST',
              url: 'https://app.fintechcore.io/api/v1/checkout/charge',
              httpVersion: 'http/2.0',
              headers: [{ name: 'content-type', value: 'application/json' }],
              queryString: [],
              cookies: [],
              headersSize: 190,
              bodySize: 120,
              postData: { mimeType: 'application/json', text: '{"amount":1245000,"currency":"eur"}' }
            },
            response: {
              status: 500,
              statusText: 'Internal Server Error',
              httpVersion: 'http/2.0',
              headers: [{ name: 'content-type', value: 'application/json' }],
              cookies: [],
              content: { size: 1100, mimeType: 'application/json', text: '{"error":"GATEWAY_TIMEOUT"}' },
              redirectURL: '',
              headersSize: 200,
              bodySize: 1100,
              _transferSize: 1100
            },
            serverIPAddress: '104.21.88.19',
            _resourceType: 'fetch'
          }
        ]
      }
    };

    const sampleEvents = [
      { type: 4, data: { href: 'https://app.fintechcore.io/checkout/invoice', width: 1440, height: 900 }, timestamp: now },
      { type: 2, data: { node: { type: 0, childNodes: [{ type: 1, name: 'html', publicId: '', systemId: '', id: 2 }, { type: 2, tagName: 'html', attributes: {}, childNodes: [{ type: 2, tagName: 'head', attributes: {}, childNodes: [], id: 4 }, { type: 2, tagName: 'body', attributes: { style: 'background:#fcf9f8;font-family:sans-serif;padding:30px;' }, childNodes: [{ type: 2, tagName: 'h1', attributes: { style: 'color:#b61819;' }, childNodes: [{ type: 3, textContent: 'Fintech Enterprise Invoice', id: 7 }], id: 6 }, { type: 2, tagName: 'p', attributes: {}, childNodes: [{ type: 3, textContent: 'Order #891-992A - Total: 12,450.00 EUR', id: 9 }], id: 8 }], id: 5 }], id: 3 }], id: 1 }, initialOffset: { left: 0, top: 0 } }, timestamp: now + 50 },
      { type: 3, data: { source: 1, positions: [{ x: 100, y: 120, id: 6, timeOffset: 500 }, { x: 250, y: 180, id: 8, timeOffset: 1500 }, { x: 420, y: 230, id: 5, timeOffset: 2500 }] }, timestamp: now + 500 },
      { type: 3, data: { source: 2, type: 2, id: 6, x: 100, y: 120 }, timestamp: now + 1500 },
      { type: 3, data: { source: 1, positions: [{ x: 560, y: 210, id: 5, timeOffset: 3500 }, { x: 570, y: 215, id: 5, timeOffset: 4500 }] }, timestamp: now + 3500 },
      { type: 3, data: { source: 2, type: 2, id: 5, x: 560, y: 210 }, timestamp: now + 4500 }
    ];

    const sampleSession = {
      id: sessionId,
      name: 'https://app.fintechcore.io/checkout/invoice/inv_8849201?currency=EUR',
      createTimestamp: now,
      modifyTimestamp: now,
      recorderVersion: '2.1.6',
      har: sampleHar
    };

    await sDb.put('sessions', sampleSession);
    await eDb.put('events', { id: sessionId, events: sampleEvents });
  });

  // Reload page to display the new session
  await page.reload();
  await page.waitForTimeout(1000);

  // Capture screenshot of Tab 01 with live loaded session
  await page.screenshot({ path: path.join(__dirname, 'screenshots/stage8_01_bauhaus_sessions_live.png'), fullPage: true });
  console.log('Saved screenshots/stage8_01_bauhaus_sessions_live.png');

  // 3. Click [ REPLAY ] button on the session row
  console.log('Clicking REPLAY on test session...');
  await page.click('.btn-play-session');
  await page.waitForTimeout(1500);

  // Capture screenshot of Tab 02 Replayer with active session loaded
  await page.screenshot({ path: path.join(__dirname, 'screenshots/stage8_02_bauhaus_replayer_active.png'), fullPage: true });
  console.log('Saved screenshots/stage8_02_bauhaus_replayer_active.png');

  // 4. Test clicking on HAR 403 row in DevTools diagnostic pane
  console.log('Selecting 403 Forbidden HAR row...');
  const row403 = await page.$('tr[data-har-index="1"]');
  if (row403) {
    await row403.click();
    await page.waitForTimeout(500);
  }

  // Capture screenshot showing HAR entry inspection drawer
  await page.screenshot({ path: path.join(__dirname, 'screenshots/stage8_03_bauhaus_har_inspector.png'), fullPage: true });
  console.log('Saved screenshots/stage8_03_bauhaus_har_inspector.png');

  // 5. Test Payload and Response tabs in Inspector
  console.log('Testing Response tab in HAR Inspector...');
  const resTabBtn = await page.$('button[data-subtab="response"]');
  if (resTabBtn) {
    await resTabBtn.click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: path.join(__dirname, 'screenshots/stage8_04_bauhaus_har_response.png'), fullPage: true });
  console.log('Saved screenshots/stage8_04_bauhaus_har_response.png');

  // 6. Test Tab 03 Timeline with live data
  console.log('Navigating to Tab 03 Timeline...');
  await page.click('a[data-tab="timeline"]');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(__dirname, 'screenshots/stage8_05_bauhaus_timeline_live.png'), fullPage: true });
  console.log('Saved screenshots/stage8_05_bauhaus_timeline_live.png');

  // 7. Test Tab 04 Engine & Hub with live session stats
  console.log('Navigating to Tab 04 Engine & Hub...');
  await page.click('a[data-tab="engine"]');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(__dirname, 'screenshots/stage8_06_bauhaus_engine_live.png'), fullPage: true });
  console.log('Saved screenshots/stage8_06_bauhaus_engine_live.png');

  // 8. Test Tab 05 Spans with live mutation data
  console.log('Navigating to Tab 05 Spans...');
  await page.click('a[data-tab="spans"]');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(__dirname, 'screenshots/stage8_07_bauhaus_spans_live.png'), fullPage: true });
  console.log('Saved screenshots/stage8_07_bauhaus_spans_live.png');

  await context.close();
  console.log('\n--- All Live Bauhaus Replay & DevTools verification steps completed successfully! ---');
})();
