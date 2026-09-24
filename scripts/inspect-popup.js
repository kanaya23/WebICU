const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const EXTENSION_PATH = path.resolve(__dirname, '..');
const CHROMIUM_PATH = 'C:\\Users\\LOLBIT\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe';

(async () => {
  const tmpDir = path.join(os.tmpdir(), 'pw-test-' + Date.now());
  const context = await chromium.launchPersistentContext(tmpDir, {
    executablePath: CHROMIUM_PATH,
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox'
    ]
  });

  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];

  // Tab 1: Live site
  const targetPage = await context.newPage();
  targetPage.on('console', m => console.log('[TARGET CONSOLE]', m.text()));
  await targetPage.goto('https://en.wikipedia.org/wiki/Main_Page', { waitUntil: 'domcontentloaded' });
  await targetPage.waitForTimeout(1000);

  // Tab 2: Popup
  const popupPage = await context.newPage();
  popupPage.on('console', m => console.log('[POPUP CONSOLE]', m.text()));
  popupPage.on('pageerror', err => console.log('[POPUP PAGEERROR]', err.message));
  await popupPage.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popupPage.waitForTimeout(1000);

  console.log('Sending StartButtonClicked directly from popup evaluate:');
  const sendRes = await popupPage.evaluate(async () => {
    try {
      const resp = await chrome.runtime.sendMessage(JSON.stringify({
        type: 'event',
        event: 'start-recording-button-clicked',
        detail: {}
      }));
      return { ok: true, resp };
    } catch (e) {
      return { error: e.message };
    }
  });
  console.log('SEND RESULT:', sendRes);

  await popupPage.waitForTimeout(2000);

  const storage = await popupPage.evaluate(() => {
    return new Promise(res => chrome.storage.local.get(null, res));
  });
  console.log('STORAGE AFTER MESSAGE:\n', JSON.stringify(storage, null, 2));

  await context.close();
})();
