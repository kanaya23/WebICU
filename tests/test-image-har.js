const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');

const CHROMIUM_PATH = 'C:\\Users\\LOLBIT\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe';
const EXTENSION_PATH = path.resolve(__dirname, '..');

(async () => {
  const tmpUserDataDir = path.join(os.tmpdir(), 'webicu-img-test-' + Date.now());
  fs.mkdirSync(tmpUserDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(tmpUserDataDir, {
    executablePath: CHROMIUM_PATH,
    headless: false,
    permissions: ['clipboard-read', 'clipboard-write'],
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ],
  });

  try {
    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extId = sw.url().split('/')[2];

    const targetPage = await context.newPage();
    await targetPage.goto('https://en.wikipedia.org/wiki/Main_Page', { waitUntil: 'domcontentloaded' });
    await targetPage.waitForTimeout(2000);

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
    await popupPage.waitForTimeout(1000);

    await popupPage.locator('[title="Start Recording"]').click();
    await popupPage.waitForTimeout(2500);

    await targetPage.bringToFront();
    // Load image and wait for onload promise
    await targetPage.evaluate(() => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ ok: true, width: img.naturalWidth });
        img.onerror = (e) => resolve({ error: true });
        img.src = 'https://en.wikipedia.org/static/images/project-logos/enwiki-25.png';
        document.body.appendChild(img);
      });
    });
    await targetPage.waitForTimeout(2000);

    await popupPage.bringToFront();
    await popupPage.locator('[title="Stop Recording"]').click();
    await popupPage.waitForTimeout(3000);

    const sessionLink = await popupPage.locator('a[href*="pages/index.html#/session/"]').getAttribute('href');
    const sessionId = sessionLink.split('/session/')[1];

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

    const imgEntry = sessionData.har.log.entries.find(e => e.request.url.includes('enwiki-25.png'));
    console.log('Image entry found:', !!imgEntry);
    if (imgEntry) {
      console.log({
        status: imgEntry.response.status,
        mimeType: imgEntry.response.content.mimeType,
        hasText: !!imgEntry.response.content.text,
        encoding: imgEntry.response.content.encoding,
        size: imgEntry.response.content.size,
        textSample: imgEntry.response.content.text ? imgEntry.response.content.text.substring(0, 40) + '...' : null
      });
    }
  } finally {
    await context.close();
  }
})();
