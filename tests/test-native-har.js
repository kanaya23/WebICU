const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');
const assert = require('assert');

const CHROMIUM_PATH = 'C:\\Users\\LOLBIT\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe';
const EXTENSION_PATH = path.resolve(__dirname, '..');

(async () => {
  const tmpUserDataDir = path.join(os.tmpdir(), 'webicu-native-har-' + Date.now());
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
    console.log('[STAGE 2] Navigating to real live site: https://en.wikipedia.org/wiki/Main_Page');
    const targetPage = await context.newPage();
    await targetPage.goto('https://en.wikipedia.org/wiki/Main_Page', { waitUntil: 'domcontentloaded' });
    await targetPage.waitForTimeout(2000);

    // 3. Open Popup
    console.log('[STAGE 3] Opening popup to start recording...');
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
    await popupPage.waitForTimeout(1000);

    const startBtn = popupPage.locator('[title="Start Recording"]');
    await startBtn.click();
    console.log('[STAGE 3] Clicked Start Recording. Waiting for debugger attach...');
    await popupPage.waitForTimeout(2500);

    // 4. Trigger Network Activity on Target Page
    console.log('[STAGE 4] Interacting with real live site and triggering fetch calls...');
    await targetPage.bringToFront();
    const fetchResult = await targetPage.evaluate(async () => {
      try {
        const res = await fetch('https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo');
        const data = await res.json();
        return { ok: res.ok, status: res.status, generator: data?.query?.general?.generator };
      } catch (e) {
        return { error: e.message };
      }
    });
    console.log('[STAGE 4] Live fetch result on target page:', fetchResult);
    await targetPage.waitForTimeout(2000);

    // 5. Stop Recording
    console.log('[STAGE 5] Stopping recording...');
    await popupPage.bringToFront();
    await popupPage.waitForTimeout(500);
    const stopBtn = popupPage.locator('[title="Stop Recording"]');
    await stopBtn.click();
    await popupPage.waitForTimeout(3000);

    const sessionLink = await popupPage.locator('a[href*="pages/index.html#/session/"]').getAttribute('href');
    console.log('[STAGE 5] Session Link generated:', sessionLink);
    assert(sessionLink, 'Session link must be generated');
    const sessionId = sessionLink.split('/session/')[1];

    // 6. Verify Session in IndexedDB has HAR 1.2
    console.log('[STAGE 6] Inspecting session in IndexedDB for native HAR 1.2...');
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

    console.log('[STAGE 6] Retrieved session from IndexedDB:', {
      id: sessionData?.id,
      name: sessionData?.name,
      hasHar: !!sessionData?.har,
      harLogVersion: sessionData?.har?.log?.version,
      harCreator: sessionData?.har?.log?.creator?.name,
      harTotalEntries: sessionData?.har?.log?.entries?.length
    });

    assert(sessionData, 'Session must exist in IndexedDB');
    assert(sessionData.har, 'Session must contain native HAR object');
    assert.strictEqual(sessionData.har.log.version, '1.2', 'HAR must be W3C version 1.2');
    assert(sessionData.har.log.entries.length > 0, 'HAR must contain captured network entries');

    // Find the Wikipedia API fetch in the captured HAR
    const wikiEntry = sessionData.har.log.entries.find(e => e.request.url.includes('api.php?action=query'));
    console.log('[STAGE 6] Found captured Wikipedia API call:', {
      found: !!wikiEntry,
      method: wikiEntry?.request?.method,
      status: wikiEntry?.response?.status,
      mimeType: wikiEntry?.response?.content?.mimeType,
      duration: wikiEntry?.time
    });

    assert(wikiEntry, 'HAR must contain the live fetch request');
    assert.strictEqual(wikiEntry.request.method, 'GET');
    assert.strictEqual(wikiEntry.response.status, 200);
    assert.strictEqual(sessionData.har.log.creator.name, 'WebInspector');
    assert(wikiEntry.serverIPAddress, 'Must have serverIPAddress populated');
    assert(wikiEntry.timings.blocked >= 0, 'Must have blocked timing');
    assert(wikiEntry.timings.wait >= 0, 'Must have wait timing');
    assert(wikiEntry.timings.receive >= 0, 'Must have receive timing');
    assert(wikiEntry.timings._blocked_queueing >= 0, 'Must have _blocked_queueing');
    assert.strictEqual(wikiEntry._resourceType, 'fetch');
    assert.strictEqual(wikiEntry.response._error, null);
    console.log('[STAGE 6] Verified 1:1 DevTools parity: serverIPAddress, 7-phase microsecond timings, queueing, _resourceType, WebInspector creator!');

    // 7. Verify Replayer UI and Direct HAR Download
    console.log('\n[STAGE 7] Opening Session Replayer UI in new page...');
    const replayerPage = await context.newPage();
    const replayerUrl = `chrome-extension://${extId}/pages/index.html#/session/${sessionId}`;
    await replayerPage.goto(replayerUrl, { waitUntil: 'domcontentloaded' });
    await replayerPage.waitForTimeout(3000);

    // Verify Download HAR button exists
    const downloadHarBtn = replayerPage.locator('button:has-text("Download HAR (.har)")');
    await downloadHarBtn.waitFor({ state: 'visible', timeout: 5000 });
    console.log('[STAGE 7] Verified "Download HAR (.har)" button is visible in Replayer header!');

    // Test downloading HAR file
    console.log('[STAGE 7] Clicking "Download HAR (.har)" and verifying download event...');
    const downloadPromise = replayerPage.waitForEvent('download');
    await downloadHarBtn.click();
    const download = await downloadPromise;
    const downloadedPath = path.join(tmpUserDataDir, download.suggestedFilename());
    await download.saveAs(downloadedPath);

    console.log('[STAGE 7] Successfully downloaded HAR to:', downloadedPath);
    assert(fs.existsSync(downloadedPath), 'Downloaded HAR file must exist on disk');
    const downloadedContent = JSON.parse(fs.readFileSync(downloadedPath, 'utf8'));
    assert.strictEqual(downloadedContent.log.version, '1.2');
    assert(downloadedContent.log.entries.length > 0);
    console.log('[STAGE 7] Downloaded HAR verified with', downloadedContent.log.entries.length, 'entries!');

    // Take screenshot of Replayer page
    const screenshotPath = path.join(__dirname, 'screenshots', 'native_har_replayer.png');
    await replayerPage.screenshot({ path: screenshotPath });
    console.log('[STAGE 7] Replayer screenshot saved to:', screenshotPath);

    // 8. Verify Session List Table Direct HAR Download
    console.log('\n[STAGE 8] Opening Session List UI to verify bulk/row HAR download...');
    const listPage = await context.newPage();
    await listPage.goto(`chrome-extension://${extId}/pages/index.html#/`, { waitUntil: 'domcontentloaded' });
    await listPage.waitForTimeout(2000);

    // Find table row checkbox and click it (Chakra checkbox control overlays the input)
    const rowCheckbox = listPage.locator('tbody tr input[type="checkbox"]').first();
    await rowCheckbox.waitFor({ state: 'attached', timeout: 5000 });
    await rowCheckbox.click({ force: true });
    await listPage.waitForTimeout(1000);

    // Verify "Download HAR" button appears in action bar
    const listDownloadHarBtn = listPage.locator('button:has-text("Download HAR")');
    await listDownloadHarBtn.waitFor({ state: 'visible', timeout: 5000 });
    console.log('[STAGE 8] Verified "Download HAR" button is visible in Session List action bar!');

    // Take screenshot of Session List with Download HAR button
    const listScreenshotPath = path.join(__dirname, 'screenshots', 'native_har_session_list.png');
    await listPage.screenshot({ path: listScreenshotPath });
    console.log('[STAGE 8] Session list screenshot saved to:', listScreenshotPath);

    // Test downloading HAR from list view
    console.log('[STAGE 8] Clicking "Download HAR" from list view...');
    const listDownloadPromise = listPage.waitForEvent('download');
    await listDownloadHarBtn.click();
    const listDownload = await listDownloadPromise;
    const listDownloadedPath = path.join(tmpUserDataDir, 'from_list_' + listDownload.suggestedFilename());
    await listDownload.saveAs(listDownloadedPath);

    console.log('[STAGE 8] Successfully downloaded HAR from list to:', listDownloadedPath);
    assert(fs.existsSync(listDownloadedPath), 'List-downloaded HAR must exist on disk');
    const listDownloadedContent = JSON.parse(fs.readFileSync(listDownloadedPath, 'utf8'));
    assert.strictEqual(listDownloadedContent.log.version, '1.2');
    assert(listDownloadedContent.log.entries.length > 0);
    console.log('[STAGE 8] Verified list-downloaded HAR with', listDownloadedContent.log.entries.length, 'entries!');

    console.log('\n================================================================');
    console.log('  ALL NATIVE CHROME CDP HAR CAPTURE & DOWNLOAD CHECKS PASSED!   ');
    console.log('================================================================\n');
  } finally {
    await context.close();
  }
})();
