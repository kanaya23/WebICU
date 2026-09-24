/**
 * WebICU Bauhaus Extension Popup Controller
 * Sleek, high-density Master Dispatch companion
 */

let recorderStatus = { status: 'IDLE', activeTabId: -1, startTimestamp: 0, pausedTimestamp: 0 };
let activeTabInfo = { id: -1, title: 'Loading...', url: '' };
let timerInterval = null;
let lastSession = null;

function formatClock(seconds) {
  const hrs = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const mins = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const secs = String(seconds % 60).padStart(2, '0');
  return `${hrs}:${mins}:${secs}`;
}

function getElapsedSeconds() {
  if (recorderStatus.status === 'IDLE' || !recorderStatus.startTimestamp) return 0;
  if (recorderStatus.status === 'PAUSED' && recorderStatus.pausedTimestamp) {
    return Math.floor((recorderStatus.pausedTimestamp - recorderStatus.startTimestamp) / 1000);
  }
  return Math.floor((Date.now() - recorderStatus.startTimestamp) / 1000);
}

function updateClock() {
  const clockEl = document.getElementById('popup-clock');
  if (clockEl) {
    clockEl.textContent = formatClock(getElapsedSeconds());
  }
}

async function fetchActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0]) {
      activeTabInfo = tabs[0];
    }
  } catch (e) {
    console.warn('Could not query active tab:', e);
  }
}

async function fetchStatus() {
  try {
    const res = await chrome.storage.local.get('recorder_status');
    if (res && res.recorder_status) {
      recorderStatus = res.recorder_status;
    }
  } catch (e) {
    console.warn('Could not fetch recorder status:', e);
  }
}

function sendEvent(eventName, detail = {}) {
  const msg = JSON.stringify({ type: 'event', event: eventName, detail });
  chrome.runtime.sendMessage(msg);
}

function render() {
  const root = document.getElementById('popup-root');
  if (!root) return;

  const isRec = recorderStatus.status === 'RECORDING';
  const isPaused = recorderStatus.status === 'PAUSED';
  const isIdle = recorderStatus.status === 'IDLE';

  let domain = 'about:blank';
  try {
    if (activeTabInfo.url) {
      const u = new URL(activeTabInfo.url);
      domain = u.hostname || activeTabInfo.url;
    }
  } catch (e) {
    domain = activeTabInfo.url || 'browser-tab';
  }

  root.innerHTML = `
    <div class="flex flex-col bg-surface min-h-[480px] p-4 text-on-surface">
      <!-- HEADER BAR -->
      <div class="bg-surface-container-high border-2 border-on-surface p-3 flex items-center justify-between shadow-tectonic-xs">
        <div class="flex items-center gap-2">
          <div class="brand-circle"></div>
          <div class="brand-square"></div>
          <div class="brand-triangle"></div>
          <span class="font-display text-xs font-bold uppercase tracking-wider ml-1">RRWEB // BAUHAUS</span>
        </div>
        <span class="chip-bauhaus ${isRec ? 'bg-primary text-white' : 'bg-surface-container-lowest text-on-surface'}">
          ${isRec ? 'REC' : (isPaused ? 'PAUSED' : 'IDLE')}
        </span>
      </div>

      <!-- TARGET TAB CARD -->
      <div class="bg-surface-container-lowest border-2 border-on-surface p-3 mt-3 shadow-tectonic-xs flex flex-col gap-1">
        <div class="flex items-center justify-between font-display text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">
          <span>TARGET TAB ATTACHMENT</span>
          <span class="text-secondary">#${activeTabInfo.id}</span>
        </div>
        <div class="font-display text-xs font-bold text-on-surface truncate" title="${activeTabInfo.title || ''}">
          ${activeTabInfo.title || 'Active Tab'}
        </div>
        <div class="font-mono text-[11px] text-on-surface-variant truncate">
          ${domain}
        </div>
      </div>

      <!-- MASTER DISPATCH CONTROLLER -->
      <div class="bg-surface-container-lowest border-2 border-on-surface p-4 mt-3 shadow-tectonic flex flex-col items-center justify-center relative">
        <div class="font-display text-[10px] font-bold uppercase text-on-surface-variant tracking-widest self-start mb-2">
          [ MASTER DISPATCH ]
        </div>

        <div class="relative w-36 h-36 rounded-full bg-tertiary-container border-2 border-on-surface flex items-center justify-center shadow-tectonic-sm my-1 cursor-pointer transition-transform active:scale-95" style="border-radius: 50% !important;">
          <button id="popup-dispatch-btn" class="w-20 h-20 rounded-full border-2 border-on-surface flex flex-col items-center justify-center shadow-tectonic-xs cursor-pointer ${isRec ? 'bg-inverse-surface text-white' : 'bg-primary text-white'}" style="border-radius: 50% !important;">
            <span class="material-symbols-outlined text-3xl">
              ${isRec ? 'stop' : (isPaused ? 'play_arrow' : 'fiber_manual_record')}
            </span>
            <span class="font-display text-[9px] font-bold uppercase tracking-widest mt-0.5">
              ${isRec ? 'HALT' : (isPaused ? 'RESUME' : 'ARMED')}
            </span>
          </button>
        </div>

        <div class="mt-2 flex flex-col items-center">
          <span id="popup-clock" class="font-display text-3xl font-bold font-mono tracking-tight text-on-surface">
            ${formatClock(getElapsedSeconds())}
          </span>
          <span class="font-display text-[9px] font-bold uppercase tracking-widest text-on-surface-variant mt-1">
            ${isRec ? 'RECORDING STREAM ACTIVE' : 'CDP NETWORK &amp; RRWEB HOOK'}
          </span>
        </div>

        ${!isIdle ? `
          <div class="flex items-center gap-2 mt-3 w-full">
            <button id="popup-pause-btn" class="btn-bauhaus flex-1 text-xs py-1.5 font-bold">
              <span class="material-symbols-outlined text-sm">${isPaused ? 'play_arrow' : 'pause'}</span>
              ${isPaused ? 'RESUME' : 'PAUSE'}
            </button>
          </div>
        ` : ''}
      </div>

      <!-- LAST SAVED SESSION NOTIFICATION -->
      ${lastSession ? `
        <div class="bg-surface-container-high border-2 border-on-surface p-2 mt-3 shadow-tectonic-xs flex items-center justify-between text-xs">
          <div class="truncate mr-2">
            <span class="font-display font-bold text-[10px] uppercase text-on-surface-variant block">NEW ARCHIVE:</span>
            <span class="font-display font-bold truncate">${lastSession.name || 'session'}</span>
          </div>
          <button id="popup-open-last-btn" class="btn-bauhaus btn-bauhaus-secondary text-[10px] py-1 px-2 shrink-0">
            VIEW
          </button>
        </div>
      ` : ''}

      <!-- ERROR MESSAGE -->
      ${recorderStatus.errorMessage ? `
        <div class="bg-error-container text-on-error-container border border-error p-2 mt-3 font-mono text-[11px]">
          ${escapeHtml(recorderStatus.errorMessage)}
        </div>
      ` : ''}

      <!-- QUICK NAVIGATION ACTION TILES -->
      <div class="grid grid-cols-2 gap-2 mt-3">
        <button id="popup-open-workbench-btn" class="btn-bauhaus btn-bauhaus-secondary text-[11px] py-2 flex items-center justify-center gap-1 shadow-tectonic-xs">
          <span class="material-symbols-outlined text-base">play_circle</span>
          <span>WORKBENCH</span>
        </button>
        <button id="popup-open-engine-btn" class="btn-bauhaus btn-bauhaus-tertiary text-[11px] py-2 flex items-center justify-center gap-1 shadow-tectonic-xs">
          <span class="material-symbols-outlined text-base">settings_input_component</span>
          <span>STORAGE HUB</span>
        </button>
      </div>
    </div>
  `;

  attachPopupEvents();
}

function attachPopupEvents() {
  const dispatchBtn = document.getElementById('popup-dispatch-btn');
  if (dispatchBtn) {
    dispatchBtn.addEventListener('click', () => {
      if (recorderStatus.status === 'RECORDING') {
        sendEvent('stop-recording-button-clicked');
      } else if (recorderStatus.status === 'PAUSED') {
        sendEvent('resume-recording-button-clicked');
      } else {
        sendEvent('start-recording-button-clicked');
      }
    });
  }

  const pauseBtn = document.getElementById('popup-pause-btn');
  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      if (recorderStatus.status === 'RECORDING') {
        sendEvent('pause-recording-button-clicked');
      } else if (recorderStatus.status === 'PAUSED') {
        sendEvent('resume-recording-button-clicked');
      }
    });
  }

  const openWorkbenchBtn = document.getElementById('popup-open-workbench-btn');
  if (openWorkbenchBtn) {
    openWorkbenchBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: '/pages/index.html#/' });
    });
  }

  const openEngineBtn = document.getElementById('popup-open-engine-btn');
  if (openEngineBtn) {
    openEngineBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: '/pages/index.html#/engine' });
    });
  }

  const openLastBtn = document.getElementById('popup-open-last-btn');
  if (openLastBtn && lastSession) {
    openLastBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: `/pages/index.html#/session/${lastSession.id}` });
    });
  }
}

// Initialize Popup
(async function initPopup() {
  await fetchActiveTab();
  await fetchStatus();
  render();

  timerInterval = setInterval(() => {
    if (recorderStatus.status === 'RECORDING') {
      updateClock();
    }
  }, 500);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.recorder_status) {
      recorderStatus = changes.recorder_status.newValue;
      render();
    }
  });

  chrome.runtime.onMessage.addListener((raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'event' && msg.event === 'session-updated') {
        lastSession = msg.detail?.session || null;
        render();
      }
    } catch (e) {}
  });
})();
