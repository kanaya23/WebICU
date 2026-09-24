const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const os = require('os');
  const extensionPath = path.resolve(__dirname, '..');
  console.log('Launching browser with extension from:', extensionPath);
  const tmpUserDataDir = path.join(os.tmpdir(), 'webicu-bauhaus-profile-' + Date.now());
  fs.mkdirSync(tmpUserDataDir, { recursive: true });
  const CHROMIUM_PATH = 'C:\\Users\\LOLBIT\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe';

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

  const page = await context.newPage();
  const consoleMessages = [];
  page.on('console', msg => {
    consoleMessages.push({ type: msg.type(), text: msg.text() });
    if (msg.type() === 'error') {
      console.error('[Browser Error]:', msg.text());
    } else {
      console.log('[Browser Log]:', msg.text());
    }
  });
  page.on('pageerror', err => {
    console.error('[Page Exception]:', err);
  });

  console.log('Waiting for background service worker...');
  let sw = context.serviceWorkers()[0];
  if (!sw) {
    try {
      sw = await context.waitForEvent('serviceworker', { timeout: 10000 });
    } catch (e) {
      console.warn('waitForEvent serviceworker timed out, checking list...');
      sw = context.serviceWorkers()[0];
    }
  }

  let extensionId = '';
  if (sw) {
    extensionId = sw.url().split('/')[2];
  }

  console.log('Detected Extension ID:', extensionId);
  if (!extensionId) {
    console.error('Could not detect extension ID');
    await context.close();
    process.exit(1);
  }

  // 1. Test Workbench Tab 01: Sessions
  console.log('\n--- 1. Testing Pages Dashboard (Tab 01: Sessions) ---');
  await page.goto(`chrome-extension://${extensionId}/pages/index.html#/sessions`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);

  fs.mkdirSync(path.join(__dirname, 'screenshots'), { recursive: true });
  await page.screenshot({ path: path.join(__dirname, 'screenshots/bauhaus_tab01_sessions.png'), fullPage: true });
  console.log('Saved screenshots/bauhaus_tab01_sessions.png');

  // 2. Test Tab 02: Replayer
  console.log('\n--- 2. Testing DevTools Replayer Workbench (Tab 02) ---');
  await page.click('a[data-tab="replayer"]');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(__dirname, 'screenshots/bauhaus_tab02_replayer.png'), fullPage: true });
  console.log('Saved screenshots/bauhaus_tab02_replayer.png');

  // 3. Test Tab 03: Timeline
  console.log('\n--- 3. Testing Synchronized Timeline (Tab 03) ---');
  await page.click('a[data-tab="timeline"]');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(__dirname, 'screenshots/bauhaus_tab03_timeline.png'), fullPage: true });
  console.log('Saved screenshots/bauhaus_tab03_timeline.png');

  // 4. Test Tab 04: Engine & Storage Hub
  console.log('\n--- 4. Testing Engine & Storage Hub (Tab 04) ---');
  await page.click('a[data-tab="engine"]');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(__dirname, 'screenshots/bauhaus_tab04_engine.png'), fullPage: true });
  console.log('Saved screenshots/bauhaus_tab04_engine.png');

  // Test IPC Ping button
  console.log('Testing IPC Ping button in Engine Hub...');
  const pingBtn = await page.$('#btn-ping-ipc');
  if (pingBtn) {
    await pingBtn.click();
    await page.waitForTimeout(500);
    const latencyText = await page.$eval('#ipc-latency-badge', el => el.textContent);
    console.log('IPC Ping result:', latencyText);
  }

  // 5. Test Tab 05: Spans & Mutations
  console.log('\n--- 5. Testing Spans & Mutations (Tab 05) ---');
  await page.click('a[data-tab="spans"]');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(__dirname, 'screenshots/bauhaus_tab05_spans.png'), fullPage: true });
  console.log('Saved screenshots/bauhaus_tab05_spans.png');

  // 6. Test Extension Popup
  console.log('\n--- 6. Testing Extension Popup ---');
  const popupPage = await context.newPage();
  await popupPage.setViewportSize({ width: 380, height: 600 });
  await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popupPage.waitForTimeout(1000);
  await popupPage.screenshot({ path: path.join(__dirname, 'screenshots/bauhaus_popup.png') });
  console.log('Saved screenshots/bauhaus_popup.png');
  await popupPage.close();

  // Check for critical browser errors
  const errors = consoleMessages.filter(m => m.type === 'error');
  console.log('\nTotal console errors recorded:', errors.length);
  if (errors.length > 0) {
    console.error('Errors:', errors);
  } else {
    console.log('Zero console errors encountered! Bauhaus UI verified successfully!');
  }

  await context.close();
  console.log('\n--- All Bauhaus UI verification tests completed! ---');
})();
