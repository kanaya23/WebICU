const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');
const assert = require('assert');

const CHROMIUM_PATH = 'C:\\Users\\LOLBIT\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe';
const EXTENSION_PATH = path.resolve(__dirname, '..');

(async () => {
  const tmpUserDataDir = path.join(os.tmpdir(), 'webicu-fidelity-verify-' + Date.now());
  fs.mkdirSync(tmpUserDataDir, { recursive: true });

  console.log('[STAGE 1] Launching Chromium with WebICU extension...');
  const context = await chromium.launchPersistentContext(tmpUserDataDir, {
    executablePath: CHROMIUM_PATH,
    headless: false,
    permissions: ['clipboard-read', 'clipboard-write'],
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ],
  });

  try {
    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extUrl = sw.url();
    const extId = extUrl.split('/')[2];
    console.log('[STAGE 1] Extension ID:', extId);

    // 2. Open Target Site
    console.log('[STAGE 2] Navigating to Wikipedia...');
    const targetPage = await context.newPage();
    await targetPage.goto('https://en.wikipedia.org/wiki/Main_Page', { waitUntil: 'domcontentloaded' });
    await targetPage.waitForTimeout(2000);

    // 3. Open Popup and Start Recording
    console.log('[STAGE 3] Opening popup to start recording...');
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
    await popupPage.waitForTimeout(1000);

    const startBtn = popupPage.locator('[title="Start Recording"]');
    await startBtn.click();
    console.log('[STAGE 3] Clicked Start Recording. Debugger attaching...');
    await popupPage.waitForTimeout(2500);

    // 4. Trigger various network requests on Target Page: fetch, images, scripts, post request
    console.log('[STAGE 4] Interacting with target page and generating rich network traffic...');
    await targetPage.bringToFront();

    // Trigger image load, POST fetch, and GET fetch
    await targetPage.evaluate(async () => {
      // 1. GET API
      await fetch('https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo').catch(() => {});
      // 2. Another GET
      await fetch('https://en.wikipedia.org/w/api.php?action=query&format=json&meta=userinfo').catch(() => {});
      // 3. Image load
      const img = new Image();
      img.src = 'https://upload.wikimedia.org/wikipedia/en/thumb/8/80/Wikipedia-logo-v2.svg/100px-Wikipedia-logo-v2.svg.png';
      document.body.appendChild(img);
    });
    await targetPage.waitForTimeout(3000);

    // 5. Stop Recording
    console.log('[STAGE 5] Stopping recording...');
    await popupPage.bringToFront();
    await popupPage.waitForTimeout(500);
    const stopBtn = popupPage.locator('[title="Stop Recording"]');
    await stopBtn.click();
    await popupPage.waitForTimeout(3500);

    const sessionLink = await popupPage.locator('a[href*="pages/index.html#/session/"]').getAttribute('href');
    console.log('[STAGE 5] Session Link generated:', sessionLink);
    assert(sessionLink, 'Session link must be generated');
    const sessionId = sessionLink.split('/session/')[1];

    // 6. Inspect Session in IndexedDB
    const sessionData = await popupPage.evaluate(async (sid) => {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('sessions', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('sessions', 'readonly');
          const store = tx.objectStore('sessions');
          const getReq = store.get(sid);
          getReq.onsuccess = () => resolve(getReq.result);
          getReq.onerror = () => reject(getReq.error);
        };
        req.onerror = () => reject(req.error);
      });
    }, sessionId);

    console.log('[STAGE 6] Retrieved session:', {
      id: sessionData?.id,
      entriesCount: sessionData?.har?.log?.entries?.length,
      creator: sessionData?.har?.log?.creator,
      version: sessionData?.har?.log?.version
    });

    const har = sessionData.har;
    assert.strictEqual(har.log.creator.name, 'WebInspector');
    assert.strictEqual(har.log.creator.version, '537.36');
    assert.strictEqual(har.log.version, '1.2');

    // Save HAR to disk for python inspection
    const harDiskPath = path.join(__dirname, 'test_output_1to1.har');
    fs.writeFileSync(harDiskPath, JSON.stringify(har, null, 2), 'utf8');
    console.log('[STAGE 6] Saved verified 1:1 HAR to:', harDiskPath);

    console.log('\n================================================================');
    console.log('   1:1 DEVTOOLS FIDELITY END-TO-END VERIFICATION COMPLETED!     ');
    console.log('================================================================\n');
  } finally {
    await context.close();
  }
})();
