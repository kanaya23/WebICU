const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const EXTENSION_PATH = path.resolve(__dirname, '..');
const CHROMIUM_PATH = 'C:\\Users\\LOLBIT\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe';

(async () => {
  const tmpDir = path.join(os.tmpdir(), 'pw-tabs-' + Date.now());
  const context = await chromium.launchPersistentContext(tmpDir, {
    executablePath: CHROMIUM_PATH,
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox'
    ]
  });

  const page1 = await context.newPage();
  await page1.goto('https://en.wikipedia.org/wiki/Main_Page');
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];

  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extId}/popup/popup.html`);

  const tabs = await popupPage.evaluate(async () => {
    return new Promise(res => chrome.tabs.query({}, res));
  });
  console.log('ALL TABS:\n', tabs.map(t => ({ id: t.id, url: t.url, title: t.title, active: t.active })));

  await context.close();
})();
