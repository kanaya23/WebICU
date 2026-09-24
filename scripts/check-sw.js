const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const EXTENSION_PATH = path.resolve(__dirname, '..');
const CHROMIUM_PATH = 'C:\\Users\\LOLBIT\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe';

(async () => {
  const tmpDir = path.join(os.tmpdir(), 'pw-sw-log-' + Date.now());
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
  console.log('SW URL:', sw.url());

  // Listen to errors
  const res = await sw.evaluate(() => {
    return {
      hasChrome: typeof chrome !== 'undefined',
      hasDebugger: !!chrome.debugger,
      hasStorage: !!chrome.storage
    };
  }).catch(err => ({ error: err.message }));

  console.log('SW EVAL:', res);

  await context.close();
})();
