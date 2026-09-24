const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');
const assert = require('assert');

const CHROMIUM_PATH = 'C:\\Users\\LOLBIT\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe';
const EXTENSION_PATH = path.resolve(__dirname, '..');

(async () => {
  const tmpUserDataDir = path.join(os.tmpdir(), 'webicu-real-site-' + Date.now());
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

    // 2. Open Real Live Site in Tab 1
    console.log('[STAGE 2] Navigating to real live site: https://en.wikipedia.org/wiki/Main_Page');
    const targetPage = await context.newPage();
    await targetPage.goto('https://en.wikipedia.org/wiki/Main_Page', { waitUntil: 'domcontentloaded' });
    await targetPage.waitForTimeout(2000);

    // 3. Open Popup
    console.log('[STAGE 3] Opening popup to start recording...');
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
    await popupPage.waitForTimeout(1000);

    await targetPage.bringToFront();
    await targetPage.waitForTimeout(500);
    await popupPage.bringToFront();
    await popupPage.waitForTimeout(500);

    const startBtn = popupPage.locator('button[title="Start Recording"]');
    await startBtn.waitFor({ state: 'visible', timeout: 5000 });
    await startBtn.click();
    await popupPage.waitForTimeout(2000);

    // 4. Interact with Real Live Site
    console.log('[STAGE 4] Interacting with real live site...');
    await targetPage.bringToFront();
    await targetPage.mouse.click(500, 300);
    await targetPage.waitForTimeout(500);
    await targetPage.mouse.wheel(0, 300);
    await targetPage.waitForTimeout(1000);
    await targetPage.mouse.wheel(0, -300);
    await targetPage.waitForTimeout(1000);

    // 5. Stop Recording
    console.log('[STAGE 5] Stopping recording...');
    await popupPage.bringToFront();
    await popupPage.waitForTimeout(500);
    const stopBtn = popupPage.locator('button[title="Stop Recording"]');
    await stopBtn.click();
    await popupPage.waitForTimeout(2000);

    const sessionLink = await popupPage.locator('a[href*="pages/index.html#/session/"]').getAttribute('href');
    console.log('[STAGE 5] Session Link:', sessionLink);
    const sessionId = sessionLink.split('/session/')[1];

    // 6. Open Replayer Page
    const replayerUrl = `chrome-extension://${extId}/pages/index.html#/session/${sessionId}`;
    console.log('[STAGE 6] Navigating to Replayer UI:', replayerUrl);
    const replayerPage = await context.newPage();
    replayerPage.on('console', msg => console.log('[REPLAYER CONSOLE]', msg.text()));
    await replayerPage.goto(replayerUrl, { waitUntil: 'domcontentloaded' });
    await replayerPage.waitForTimeout(3000);

    // Inspect layout and scaling
    const layout = await replayerPage.evaluate(() => {
      const wrap = document.querySelector('.replayer-wrapper');
      const iframe = document.querySelector('.replayer-wrapper iframe');
      const frame = document.querySelector('.rr-player__frame');
      const player = document.querySelector('.rr-player');
      const playerContainer = document.querySelector('.webicu-player-container');

      return {
        wrap: wrap ? {
          styleTransform: wrap.style.transform,
          computedTransform: window.getComputedStyle(wrap).transform,
          rect: wrap.getBoundingClientRect(),
          offsetWidth: wrap.offsetWidth,
          offsetHeight: wrap.offsetHeight,
        } : null,
        iframe: iframe ? {
          widthAttr: iframe.getAttribute('width'),
          heightAttr: iframe.getAttribute('height'),
          rect: iframe.getBoundingClientRect(),
          offsetWidth: iframe.offsetWidth,
          offsetHeight: iframe.offsetHeight,
        } : null,
        frame: frame ? {
          rect: frame.getBoundingClientRect(),
          offsetWidth: frame.offsetWidth,
          offsetHeight: frame.offsetHeight,
        } : null,
        player: player ? {
          rect: player.getBoundingClientRect(),
          offsetWidth: player.offsetWidth,
          offsetHeight: player.offsetHeight,
        } : null,
        playerContainer: playerContainer ? {
          rect: playerContainer.getBoundingClientRect(),
          offsetWidth: playerContainer.offsetWidth,
          offsetHeight: playerContainer.offsetHeight,
        } : null,
      };
    });

    console.log('REAL SITE REPLAYER LAYOUT DIAGNOSTICS:');
    console.log(JSON.stringify(layout, null, 2));

    assert(layout.wrap, 'Replayer wrapper must exist');
    assert(layout.iframe, 'Replayer iframe must exist');
    assert(layout.frame, 'Player frame must exist');

    // 1. Verify wrapper height matches iframe (mouse-tail is position: absolute, not pushing iframe down)
    console.log(`[ASSERT 1] Checking wrapper dimensions: wrap.offsetHeight=${layout.wrap.offsetHeight}, iframe.offsetHeight=${layout.iframe.offsetHeight}`);
    assert.strictEqual(layout.wrap.offsetHeight, layout.iframe.offsetHeight, 'Wrapper offsetHeight must match iframe offsetHeight without mouse-tail pushdown');

    // 2. Verify vertical centering within frame
    const iframeCenterY = (layout.iframe.rect.top + layout.iframe.rect.bottom) / 2;
    const frameCenterY = (layout.frame.rect.top + layout.frame.rect.bottom) / 2;
    console.log(`[ASSERT 2] Vertical centers: iframe=${iframeCenterY.toFixed(2)}, frame=${frameCenterY.toFixed(2)}`);
    assert(Math.abs(iframeCenterY - frameCenterY) < 3, `Replayer iframe must be vertically centered in frame (diff: ${Math.abs(iframeCenterY - frameCenterY)})`);

    // 3. Verify horizontal centering within frame
    const iframeCenterX = (layout.iframe.rect.left + layout.iframe.rect.right) / 2;
    const frameCenterX = (layout.frame.rect.left + layout.frame.rect.right) / 2;
    console.log(`[ASSERT 3] Horizontal centers: iframe=${iframeCenterX.toFixed(2)}, frame=${frameCenterX.toFixed(2)}`);
    assert(Math.abs(iframeCenterX - frameCenterX) < 3, `Replayer iframe must be horizontally centered in frame (diff: ${Math.abs(iframeCenterX - frameCenterX)})`);

    // 4. Verify containment: iframe should not overflow frame boundaries
    console.log(`[ASSERT 4] Containment check: iframe [${layout.iframe.rect.top.toFixed(1)}, ${layout.iframe.rect.bottom.toFixed(1)}] vs frame [${layout.frame.rect.top.toFixed(1)}, ${layout.frame.rect.bottom.toFixed(1)}]`);
    assert(layout.iframe.rect.top >= layout.frame.rect.top - 2, 'Iframe top must not be pushed out of frame');
    assert(layout.iframe.rect.bottom <= layout.frame.rect.bottom + 2, 'Iframe bottom must not be cut off');

    console.log('\n>>> ALL REAL LIVE SITE REPLAYER VIEWPORT & CENTERING CHECKS PASSED SUCCESSFULLY! <<<\n');
  } finally {
    await context.close();
  }
})();
