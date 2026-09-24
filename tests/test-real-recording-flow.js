const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');

(async () => {
  const extPath = path.resolve('.');
  const tmpDir = path.join(os.tmpdir(), 'chrome_rec_test_' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  console.log('Testing real recording flow...');
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

  // 1. Target page
  const targetPage = await ctx.newPage();
  await targetPage.goto('https://example.com');
  await targetPage.waitForTimeout(1000);

  // 2. Open popup
  const popupPage = await ctx.newPage();
  await popupPage.goto('chrome-extension://' + extId + '/popup/popup.html');
  await popupPage.waitForTimeout(1000);

  const startBtn = popupPage.locator('[title="Start Recording"]').first();
  console.log('Start button count:', await startBtn.count());
  await startBtn.click();
  console.log('Clicked Start Recording!');

  await popupPage.waitForTimeout(2000);
  await popupPage.screenshot({ path: 'tests/screenshots/rec_active.png' });
  console.log('Saved rec_active.png');

  // 3. Make some DOM mutations on target page
  await targetPage.bringToFront();
  await targetPage.evaluate(() => {
    const h = document.createElement('h2');
    h.textContent = 'Live DOM Mutation Recorded by WebICU Bauhaus';
    h.style.color = '#b61819';
    document.body.appendChild(h);
  });
  await targetPage.waitForTimeout(1500);

  // 4. Stop recording in popup
  await popupPage.bringToFront();
  const stopBtn = popupPage.locator('[title="Stop Recording"]').first();
  console.log('Stop button count:', await stopBtn.count());
  await stopBtn.click();
  console.log('Clicked Stop Recording!');

  await popupPage.waitForTimeout(2000);
  await popupPage.screenshot({ path: 'tests/screenshots/rec_stopped.png' });
  console.log('Saved rec_stopped.png');

  // 5. Open sessions page to see the newly recorded session
  const sessionsPage = await ctx.newPage();
  await sessionsPage.goto('chrome-extension://' + extId + '/pages/index.html#/');
  await sessionsPage.waitForTimeout(2000);
  await sessionsPage.screenshot({ path: 'tests/screenshots/rec_sessions_list.png' });
  console.log('Saved rec_sessions_list.png');

  await ctx.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch(e){}
  console.log('Real recording test finished successfully!');
})();
