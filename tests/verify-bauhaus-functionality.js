const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');

(async () => {
  const extPath = path.resolve('.');
  const tmpDir = path.join(os.tmpdir(), 'chrome_bauhaus_test_' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  console.log('Launching browser with extension...');
  const ctx = await chromium.launchPersistentContext(tmpDir, {
    headless: false,
    executablePath: 'C:\\Users\\LOLBIT\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe',
    args: [
      '--disable-extensions-except=' + extPath,
      '--load-extension=' + extPath,
      '--no-sandbox',
    ]
  });

  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  console.log('Extension ID:', extId);

  // 1. Popup
  const popupPage = await ctx.newPage();
  await popupPage.goto('chrome-extension://' + extId + '/popup/popup.html');
  await popupPage.waitForTimeout(1000);
  await popupPage.screenshot({ path: 'tests/screenshots/bauhaus_v2_popup.png' });
  console.log('Saved bauhaus_v2_popup.png');

  // 2. Sessions Page & Inject Session
  const page = await ctx.newPage();
  await page.goto('chrome-extension://' + extId + '/pages/index.html#/');
  await page.waitForTimeout(1000);

  await page.evaluate(async () => {
    const sDbReq = indexedDB.open('sessions', 1);
    sDbReq.onupgradeneeded = (e) => {
      e.target.result.createObjectStore('sessions', { keyPath: 'id', autoIncrement: false });
    };
    const sDb = await new Promise((res, rej) => {
      sDbReq.onsuccess = () => res(sDbReq.result);
      sDbReq.onerror = () => rej(sDbReq.error);
    });

    const eDbReq = indexedDB.open('events', 1);
    eDbReq.onupgradeneeded = (e) => {
      e.target.result.createObjectStore('events', { keyPath: 'id', autoIncrement: false });
    };
    const eDb = await new Promise((res, rej) => {
      eDbReq.onsuccess = () => res(eDbReq.result);
      eDbReq.onerror = () => rej(eDbReq.error);
    });

    const testId = 'test-session-001';
    const now = Date.now();
    const sessionObj = {
      id: testId,
      name: 'Wikipedia - Bauhaus Movement Research',
      tags: ['research', 'art'],
      createTimestamp: now - 120000,
      modifyTimestamp: now,
      recorderVersion: '0.0.1',
      har: {
        log: {
          version: '1.2',
          creator: { name: 'WebInspector', version: '537.36' },
          entries: [
            {
              startedDateTime: new Date(now - 100000).toISOString(),
              time: 45,
              request: { method: 'GET', url: 'https://en.wikipedia.org/wiki/Bauhaus', headers: [] },
              response: { status: 200, statusText: 'OK', headers: [], content: { mimeType: 'text/html', size: 1024 } }
            }
          ]
        }
      }
    };

    const txS = sDb.transaction('sessions', 'readwrite');
    txS.objectStore('sessions').put(sessionObj);
    await new Promise(r => txS.oncomplete = r);

    const baseTime = now - 100000;
    const eventsObj = {
      id: testId,
      events: [
        { type: 4, data: { href: 'https://en.wikipedia.org/wiki/Bauhaus', width: 1280, height: 720 }, timestamp: baseTime },
        { type: 2, data: { node: { type: 0, childNodes: [{ type: 1, name: 'html', publicId: '', systemId: '', id: 2 }, { type: 2, tagName: 'html', attributes: {}, id: 3, childNodes: [{ type: 2, tagName: 'head', attributes: {}, id: 4, childNodes: [] }, { type: 2, tagName: 'body', attributes: { style: 'background:#fafafa;font-family:sans-serif;padding:40px;' }, id: 5, childNodes: [{ type: 2, tagName: 'h1', attributes: {}, id: 6, childNodes: [{ type: 3, textContent: 'Staatliches Bauhaus Art & Architecture', id: 7 }] }, { type: 2, tagName: 'p', attributes: {}, id: 8, childNodes: [{ type: 3, textContent: 'Form follows function. The Bauhaus style emphasizes clean geometric forms and primary colors.', id: 9 }] }] }] }] }, initialOffset: { top: 0, left: 0 } }, timestamp: baseTime + 50 },
        { type: 3, data: { source: 1, positions: [{ x: 100, y: 100, id: 5, timeOffset: 0 }, { x: 300, y: 250, id: 5, timeOffset: 500 }] }, timestamp: baseTime + 500 },
        { type: 3, data: { source: 1, positions: [{ x: 300, y: 250, id: 5, timeOffset: 0 }, { x: 500, y: 350, id: 5, timeOffset: 500 }] }, timestamp: baseTime + 1000 }
      ]
    };

    const txE = eDb.transaction('events', 'readwrite');
    txE.objectStore('events').put(eventsObj);
    await new Promise(r => txE.oncomplete = r);
  });

  await page.reload();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'tests/screenshots/bauhaus_v2_sessions_list.png' });
  console.log('Saved bauhaus_v2_sessions_list.png');

  // Select row using force: true
  const rowCheckbox = await page.locator('tbody tr input[type="checkbox"]').first();
  if (await rowCheckbox.count() > 0) {
    await rowCheckbox.click({ force: true });
    await page.waitForTimeout(600);
    await page.screenshot({ path: 'tests/screenshots/bauhaus_v2_sessions_selected.png' });
    console.log('Saved bauhaus_v2_sessions_selected.png');
  }

  // Go to replayer
  const replayerPage = await ctx.newPage();
  await replayerPage.goto('chrome-extension://' + extId + '/pages/index.html#/session/test-session-001');
  await replayerPage.waitForTimeout(2500);
  await replayerPage.screenshot({ path: 'tests/screenshots/bauhaus_v2_replayer.png' });
  console.log('Saved bauhaus_v2_replayer.png');

  // Check options page
  const optPage = await ctx.newPage();
  await optPage.goto('chrome-extension://' + extId + '/options/index.html');
  await optPage.waitForTimeout(1000);
  await optPage.screenshot({ path: 'tests/screenshots/bauhaus_v2_options.png' });
  console.log('Saved bauhaus_v2_options.png');

  await ctx.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch(e){}
  console.log('All tests completed successfully!');
})();
