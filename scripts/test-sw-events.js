const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const EXTENSION_PATH = path.resolve(__dirname, '..');
const CHROMIUM_PATH = 'C:\\Users\\LOLBIT\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe';

(async () => {
  const tmpDir = path.join(os.tmpdir(), 'pw-sw-events-' + Date.now());
  const context = await chromium.launchPersistentContext(tmpDir, {
    executablePath: CHROMIUM_PATH,
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox'
    ]
  });

  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = sw.url().split('/')[2];
  console.log('[TEST] Service worker found:', sw.url());

  // Open Target Web Page
  const targetPage = await context.newPage();
  console.log('[TEST] Navigating target page to Wikipedia...');
  await targetPage.goto('https://en.wikipedia.org/wiki/Main_Page', { waitUntil: 'domcontentloaded' });
  await targetPage.waitForTimeout(1500);

  // Open Popup
  console.log('[TEST] Opening popup...');
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popupPage.waitForTimeout(1500);

  // Check initial storage
  const initStorage = await popupPage.evaluate(() => {
    return new Promise(res => chrome.storage.local.get(null, res));
  });
  console.log('[TEST] Initial storage.local:', initStorage);

  console.log('[TEST] Clicking [title="Start Recording"]...');
  const startBtn = popupPage.locator('[title="Start Recording"]');
  await startBtn.click();
  await popupPage.waitForTimeout(3000);

  const afterStorage = await popupPage.evaluate(() => {
    return new Promise(res => chrome.storage.local.get(null, res));
  });
  console.log('[TEST] Storage after click:', afterStorage);

  const btnTitles = await popupPage.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).map(b => b.getAttribute('title'));
  });
  console.log('[TEST] Button titles after click:', btnTitles);

  await context.close();
})();
