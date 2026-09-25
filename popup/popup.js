// popup.js - Minimalist Bauhaus Popup Module
let timerInterval = null;
let currentStatus = 'IDLE';
let startTimestamp = null;
let accumulatedPausedMs = 0;
let lastSessionId = null;

const statusPill = document.getElementById('statusPill');
const statusText = document.getElementById('statusText');
const tabTitleEl = document.getElementById('tabTitle');
const timerDisplay = document.getElementById('timerDisplay');
const eventCountDisplay = document.getElementById('eventCountDisplay');
const startBtn = document.getElementById('startBtn');
const activeControls = document.getElementById('activeControls');
const pauseBtn = document.getElementById('pauseBtn');
const pauseBtnText = document.getElementById('pauseBtnText');
const stopBtn = document.getElementById('stopBtn');
const openDashboardBtn = document.getElementById('openDashboardBtn');
const dispatchSection = document.getElementById('dispatchSection');
const cdpEngineToggle = document.getElementById('cdpEngineToggle');
const engineModeSub = document.getElementById('engineModeSub');

function updateEngineToggleUI(isCdp) {
  if (engineModeSub) {
    engineModeSub.textContent = isCdp
      ? 'CDP Debugger (Low-level engine)'
      : 'Stealth MV3 (Silent)';
  }
}

function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [
    hours.toString().padStart(2, '0'),
    minutes.toString().padStart(2, '0'),
    seconds.toString().padStart(2, '0')
  ].join(':');
}

function updateTimer() {
  if (currentStatus === 'RECORDING' && startTimestamp) {
    const elapsed = Date.now() - startTimestamp - accumulatedPausedMs;
    if (timerDisplay) timerDisplay.textContent = formatDuration(elapsed);
  }
}

function renderState(state) {
  currentStatus = state.status || 'IDLE';
  startTimestamp = state.startTimestamp;
  accumulatedPausedMs = state.accumulatedPausedMs || 0;
  lastSessionId = state.sessionId;

  if (statusPill) {
    statusPill.className = 'status-pill';
    if (currentStatus === 'RECORDING') {
      statusPill.classList.add('status-recording');
      if (statusText) statusText.textContent = 'REC';
      if (startBtn) startBtn.style.display = 'none';
      if (activeControls) activeControls.style.display = 'grid';
      if (pauseBtnText) pauseBtnText.textContent = 'Pause';
      if (dispatchSection) dispatchSection.classList.add('recording-active');
    } else if (currentStatus === 'PAUSED') {
      statusPill.classList.add('status-paused');
      if (statusText) statusText.textContent = 'PAUSED';
      if (startBtn) startBtn.style.display = 'none';
      if (activeControls) activeControls.style.display = 'grid';
      if (pauseBtnText) pauseBtnText.textContent = 'Resume';
      if (dispatchSection) dispatchSection.classList.add('recording-active');
    } else {
      statusPill.classList.add('status-idle');
      if (statusText) statusText.textContent = 'ARMED';
      if (startBtn) startBtn.style.display = 'flex';
      if (activeControls) activeControls.style.display = 'none';
      if (timerDisplay) timerDisplay.textContent = '00:00:00';
      if (dispatchSection) dispatchSection.classList.remove('recording-active');
    }
  }

  const evCount = state.eventCount || 0;
  if (eventCountDisplay) {
    eventCountDisplay.textContent = `${evCount} event${evCount === 1 ? '' : 's'}`;
  }

  if (currentStatus !== 'IDLE' && state.sessionTitle && tabTitleEl) {
    tabTitleEl.textContent = state.sessionTitle;
  }

  if (cdpEngineToggle) {
    if (currentStatus !== 'IDLE') {
      cdpEngineToggle.disabled = true;
      if (state.useCdp !== undefined) {
        cdpEngineToggle.checked = !!state.useCdp;
        updateEngineToggleUI(!!state.useCdp);
      }
    } else {
      cdpEngineToggle.disabled = false;
    }
  }

  updateTimer();
}

async function fetchStatus() {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
      if (chrome.runtime.lastError || !res) return;
      renderState(res);
    });
  }
}

// Initialize popup
async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tabTitleEl) {
      tabTitleEl.textContent = tab.title || tab.url || 'Active Tab';
      tabTitleEl.title = tab.url || tab.title || '';
    }
  } catch (e) {}

  if (cdpEngineToggle) {
    try {
      const data = await chrome.storage.local.get(['webicu_use_cdp', 'rrweb_use_cdp']);
      const isCdp = !!(data.webicu_use_cdp || data.rrweb_use_cdp);
      cdpEngineToggle.checked = isCdp;
      updateEngineToggleUI(isCdp);

      cdpEngineToggle.addEventListener('change', () => {
        const checked = cdpEngineToggle.checked;
        updateEngineToggleUI(checked);
        chrome.storage.local.set({ webicu_use_cdp: checked });
      });
    } catch (_) {}
  }

  await fetchStatus();

  // Poll status while popup is open to keep timer and count updated
  timerInterval = setInterval(() => {
    updateTimer();
    fetchStatus();
  }, 500);
}

if (startBtn) {
  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    const useCdp = cdpEngineToggle ? cdpEngineToggle.checked : false;
    chrome.runtime.sendMessage({ type: 'START_RECORDING', useCdp }, (res) => {
      startBtn.disabled = false;
      if (res && res.success) {
        fetchStatus();
      } else if (res && res.error) {
        alert('Could not start recording: ' + res.error);
      }
    });
  });
}

if (pauseBtn) {
  pauseBtn.addEventListener('click', async () => {
    pauseBtn.disabled = true;
    const msgType = currentStatus === 'PAUSED' ? 'RESUME_RECORDING' : 'PAUSE_RECORDING';
    chrome.runtime.sendMessage({ type: msgType }, () => {
      pauseBtn.disabled = false;
      fetchStatus();
    });
  });
}

if (stopBtn) {
  stopBtn.addEventListener('click', async () => {
    stopBtn.disabled = true;
    if (statusText) statusText.textContent = 'SAVING...';

    let didHandle = false;
    const finishStop = (sessionId) => {
      if (didHandle) return;
      didHandle = true;
      stopBtn.disabled = false;
      const targetSessionId = sessionId || lastSessionId;
      if (targetSessionId) {
        chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD', sessionId: targetSessionId });
        window.close();
      } else {
        fetchStatus();
      }
    };

    // Safety watchdog: never leave user stuck on disabled grey screen
    const safetyTimer = setTimeout(() => {
      finishStop(lastSessionId);
    }, 2000);

    chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (res) => {
      clearTimeout(safetyTimer);
      finishStop(res && res.sessionId);
    });
  });
}

if (openDashboardBtn) {
  openDashboardBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
    window.close();
  });
}

window.addEventListener('unload', () => {
  if (timerInterval) clearInterval(timerInterval);
});

init();
