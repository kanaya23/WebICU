/**
 * WebICU Bauhaus Telemetry Workbench
 * High-performance, zero-dependency native ES module implementation
 * Strict 1:1 Bauhaus Telemetry System fidelity & live extension integration
 */

import {
  RRWebPlayer,
  getSession,
  getSessionEvents,
  getAllSessions,
  deleteSessions,
  exportSessionJson,
  exportSessionHar,
  purgeAllData
} from "./index.js";

// Global Workbench State
const state = {
  activeTab: 'sessions', // 'sessions' | 'replayer' | 'timeline' | 'engine' | 'spans'
  sessions: [],
  selectedSessionId: null,
  activeSession: null,
  activeEvents: [],
  activeHar: null,
  activeHarEntries: [],
  selectedHarIndex: 0,
  selectedHarSubtab: 'headers', // 'headers' | 'payload' | 'response'
  harFilter: '',
  harTypeFilter: 'ALL',
  replayer: null,
  playerInstance: null,
  isPlaying: false,
  currentTimeMs: 0,
  totalDurationMs: 0,
  playbackSpeed: 1.0,
  selectedSessionIds: new Set(),
  storageEstimate: { usage: 0, quota: 0 },
  recorderStatus: { status: 'IDLE', activeTabId: -1 },
  sessionClockInterval: null,
  sessionClockSeconds: 0
};

// --- Utilities ---
function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatTime(ms) {
  if (!ms || ms < 0) return '00:00.00';
  const totalSeconds = ms / 1000;
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  const hundredths = Math.floor((ms % 1000) / 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

function formatClock(totalSeconds) {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg, isError = false) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast-banner flex items-center gap-3';
  if (isError) {
    toast.style.borderColor = 'var(--primary)';
    toast.style.boxShadow = '4px 4px 0px var(--primary)';
  }
  toast.innerHTML = `
    <span class="material-symbols-outlined" style="color: ${isError ? 'var(--primary)' : 'var(--tertiary-fixed)'}">
      ${isError ? 'error' : 'info'}
    </span>
    <span class="font-display font-bold uppercase tracking-wide text-xs" style="color: var(--inverse-on-surface)">
      ${escapeHtml(msg)}
    </span>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 2800);
}

// --- Background IPC & State Sync ---
async function syncRecorderStatus() {
  try {
    const res = await chrome.storage.local.get('recorder_status');
    if (res && res.recorder_status) {
      state.recorderStatus = res.recorder_status;
      updateSidebarFooter();
      updateTopBarStatus();
      if (state.activeTab === 'engine') {
        updateEngineTabStatus();
      }
    }
  } catch (e) {
    console.warn('Could not sync recorder status:', e);
  }
}

function updateSidebarFooter() {
  const isRec = state.recorderStatus.status === 'RECORDING';
  const badgeEl = document.getElementById('sidebar-rec-badge');
  const bufferEl = document.getElementById('sidebar-buffer-stat');
  if (badgeEl) {
    badgeEl.textContent = isRec ? 'REC ACTIVE' : 'STANDBY';
    badgeEl.style.backgroundColor = isRec ? 'var(--primary)' : 'var(--on-surface)';
    badgeEl.style.color = '#fff';
  }
  if (bufferEl) {
    bufferEl.textContent = isRec ? 'BUFFER: STREAMING // 60Hz' : 'SYSTEM READY // IDLE';
  }
}

function updateTopBarStatus() {
  const isRec = state.recorderStatus.status === 'RECORDING';
  const recBadge = document.getElementById('top-rec-badge');
  if (recBadge) {
    recBadge.textContent = isRec ? 'RECORDING' : 'IDLE';
    recBadge.style.backgroundColor = isRec ? 'var(--primary)' : 'var(--surface-container-high)';
    recBadge.style.color = isRec ? '#fff' : 'var(--on-surface)';
  }
}

// --- Navigation & Routing ---
function switchTab(tabName) {
  state.activeTab = tabName;
  window.location.hash = `#/${tabName}`;
  render();
}

function parseRoute() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  if (hash.startsWith('session/')) {
    const id = hash.replace('session/', '');
    state.selectedSessionId = id;
    state.activeTab = 'replayer';
    loadSessionForReplay(id);
    return;
  }
  if (['sessions', 'replayer', 'timeline', 'engine', 'spans'].includes(hash)) {
    state.activeTab = hash;
  } else {
    state.activeTab = 'sessions';
  }
  render();
}

// --- Data Operations ---
async function refreshSessions() {
  try {
    state.sessions = await getAllSessions();
    if (navigator.storage && navigator.storage.estimate) {
      state.storageEstimate = await navigator.storage.estimate();
    }
  } catch (e) {
    console.error('Error fetching sessions:', e);
  }
}

async function loadSessionForReplay(sessionId) {
  try {
    state.selectedSessionId = sessionId;
    const session = await getSession(sessionId);
    const events = await getSessionEvents(sessionId);
    state.activeSession = session;
    state.activeEvents = events || [];
    state.activeHar = session?.har || null;
    state.activeHarEntries = session?.har?.log?.entries || [];
    state.selectedHarIndex = 0;
    render();
    initReplayer();
  } catch (e) {
    console.error('Failed to load session:', e);
    showToast('FAILED TO LOAD SESSION PAYLOAD', true);
  }
}

// --- Replayer Setup & Bi-directional Sync ---
function initReplayer() {
  const container = document.getElementById('rrweb-stage-canvas');
  if (!container || !state.activeEvents || state.activeEvents.length === 0) return;

  // Clean existing player instance
  if (state.playerInstance) {
    try {
      state.playerInstance.pause();
      state.playerInstance.$destroy();
    } catch (e) {}
    state.playerInstance = null;
  }
  container.innerHTML = '';

  try {
    // Inject local rrweb-player stylesheet if not present
    if (!document.getElementById('rrweb-player-style')) {
      const link = document.createElement('link');
      link.id = 'rrweb-player-style';
      link.rel = 'stylesheet';
      link.href = '/pages/rrweb-player.css';
      document.head.appendChild(link);
    }

    state.playerInstance = new RRWebPlayer({
      target: container,
      props: {
        events: state.activeEvents,
        autoPlay: false,
        showController: false // We use our Bauhaus Mechanical Scrubber!
      }
    });

    state.replayer = state.playerInstance.getReplayer();
    const meta = state.playerInstance.getMetaData();
    state.totalDurationMs = meta?.totalTime || (state.activeEvents[state.activeEvents.length - 1].timestamp - state.activeEvents[0].timestamp);
    state.currentTimeMs = 0;
    state.isPlaying = false;

    // Listen to time updates
    state.playerInstance.addEventListener('ui-update', ({ payload }) => {
      state.currentTimeMs = payload;
      syncReplayProgress();
    });

    // Listen to pause/finish
    state.replayer.on('pause', () => {
      state.isPlaying = false;
      updatePlayPauseButton();
    });
    state.replayer.on('finish', () => {
      state.isPlaying = false;
      updatePlayPauseButton();
    });

    // Populate milestone markers on the mechanical scrubber
    populateScrubberMilestones();
    syncReplayProgress();
    updatePlayPauseButton();
  } catch (e) {
    console.error('Failed to instantiate rrweb player:', e);
    showToast('REPLAYER ENGINE INITIALIZATION ERROR', true);
  }
}

function syncReplayProgress() {
  const timeCurrentEl = document.getElementById('time-current');
  const timeTotalEl = document.getElementById('time-total');
  const fillEl = document.getElementById('scrubber-fill');
  const thumbEl = document.getElementById('scrubber-thumb');
  const frameEl = document.getElementById('frame-counter');

  if (timeCurrentEl) timeCurrentEl.textContent = formatTime(state.currentTimeMs);
  if (timeTotalEl) timeTotalEl.textContent = formatTime(state.totalDurationMs);

  const pct = state.totalDurationMs > 0 ? (state.currentTimeMs / state.totalDurationMs) * 100 : 0;
  if (fillEl) fillEl.style.width = `${pct}%`;
  if (thumbEl) thumbEl.style.left = `${pct}%`;

  if (frameEl && state.activeEvents && state.activeEvents.length > 0) {
    const currentAbsolute = state.activeEvents[0].timestamp + state.currentTimeMs;
    const evIndex = state.activeEvents.findIndex(ev => ev.timestamp >= currentAbsolute);
    frameEl.textContent = `#${String(evIndex === -1 ? state.activeEvents.length : evIndex + 1).padStart(5, '0')}`;
  }

  // Highlight active HAR request corresponding to playhead
  highlightActiveHarForTimestamp(state.currentTimeMs);
}

function highlightActiveHarForTimestamp(timeMs) {
  if (!state.activeHarEntries || state.activeHarEntries.length === 0 || !state.activeEvents[0]) return;
  const sessionStart = state.activeEvents[0].timestamp;
  const currentTimestamp = sessionStart + timeMs;

  let activeIdx = -1;
  state.activeHarEntries.forEach((entry, idx) => {
    const reqStart = new Date(entry.startedDateTime).getTime();
    const reqEnd = reqStart + (entry.time || 0);
    if (currentTimestamp >= reqStart && currentTimestamp <= reqEnd + 200) {
      activeIdx = idx;
    }
  });

  const rows = document.querySelectorAll('#har-table-body tr');
  rows.forEach((row, i) => {
    if (i === activeIdx) {
      row.style.outline = '2px solid var(--secondary)';
      row.style.backgroundColor = 'var(--surface-container-high)';
    } else if (i !== state.selectedHarIndex) {
      row.style.outline = 'none';
      row.style.backgroundColor = '';
    }
  });
}

function populateScrubberMilestones() {
  const track = document.getElementById('scrubber-track');
  if (!track || !state.activeHarEntries || !state.activeEvents[0] || state.totalDurationMs <= 0) return;

  const existingMilestones = track.querySelectorAll('.milestone-error, .milestone-network');
  existingMilestones.forEach(m => m.remove());

  const sessionStart = state.activeEvents[0].timestamp;

  state.activeHarEntries.forEach((entry, idx) => {
    const reqStart = new Date(entry.startedDateTime).getTime();
    const relMs = reqStart - sessionStart;
    if (relMs >= 0 && relMs <= state.totalDurationMs) {
      const pct = (relMs / state.totalDurationMs) * 100;
      const isError = entry.response && entry.response.status >= 400;
      const marker = document.createElement('div');
      marker.className = isError ? 'milestone-error' : 'milestone-network';
      marker.style.left = `${pct}%`;
      marker.title = `${entry.request.method} ${entry.request.url} (${entry.response.status})`;
      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        seekToMs(relMs);
        selectHarEntry(idx);
      });
      track.appendChild(marker);
    }
  });
}

function togglePlay() {
  if (!state.playerInstance) return;
  state.isPlaying = !state.isPlaying;
  if (state.isPlaying) {
    state.playerInstance.play();
  } else {
    state.playerInstance.pause();
  }
  updatePlayPauseButton();
}

function updatePlayPauseButton() {
  const btn = document.getElementById('btn-play-pause');
  if (!btn) return;
  const icon = btn.querySelector('.material-symbols-outlined');
  if (icon) {
    icon.textContent = state.isPlaying ? 'pause' : 'play_arrow';
  }
}

function seekToMs(ms) {
  if (!state.playerInstance) return;
  const clamped = Math.max(0, Math.min(ms, state.totalDurationMs));
  state.currentTimeMs = clamped;
  state.playerInstance.goto(clamped, state.isPlaying);
  syncReplayProgress();
}

function stepTime(deltaMs) {
  seekToMs(state.currentTimeMs + deltaMs);
}

function setPlaybackSpeed(speed) {
  state.playbackSpeed = speed;
  if (state.playerInstance) {
    state.playerInstance.setSpeed(speed);
  }
  const speedButtons = document.querySelectorAll('.btn-speed-tile');
  speedButtons.forEach(btn => {
    const sp = parseFloat(btn.dataset.speed);
    if (sp === speed) {
      btn.classList.add('bg-on-surface', 'text-surface');
      btn.style.backgroundColor = 'var(--on-surface)';
      btn.style.color = '#fff';
    } else {
      btn.classList.remove('bg-on-surface', 'text-surface');
      btn.style.backgroundColor = 'var(--surface)';
      btn.style.color = 'var(--on-surface)';
    }
  });
}

function selectHarEntry(idx) {
  state.selectedHarIndex = idx;
  const rows = document.querySelectorAll('#har-table-body tr');
  rows.forEach((row, i) => {
    if (i === idx) {
      row.style.outline = '2px solid var(--secondary)';
      row.style.backgroundColor = 'var(--surface-container-high)';
    } else {
      row.style.outline = 'none';
      row.style.backgroundColor = '';
    }
  });
  renderHarEntryInspector();
}

function renderHarEntryInspector() {
  const container = document.getElementById('har-inspector-content');
  const titleEl = document.getElementById('har-inspector-title');
  if (!container || !state.activeHarEntries || state.activeHarEntries.length === 0) return;

  const entry = state.activeHarEntries[state.selectedHarIndex];
  if (!entry) {
    container.innerHTML = '<div class="p-4 text-on-surface-variant font-mono">NO ENTRY SELECTED</div>';
    return;
  }

  const url = new URL(entry.request.url);
  if (titleEl) {
    titleEl.textContent = `HAR ENTRY: ${entry.request.method} ${url.pathname}`;
  }

  if (state.selectedHarSubtab === 'headers') {
    let reqHeadersHtml = entry.request.headers.map(h => 
      `<div class="flex gap-2"><span class="font-bold text-secondary">${escapeHtml(h.name)}:</span><span class="text-on-surface">${escapeHtml(h.value)}</span></div>`
    ).join('');
    let resHeadersHtml = entry.response.headers.map(h => 
      `<div class="flex gap-2"><span class="font-bold text-secondary">${escapeHtml(h.name)}:</span><span class="text-on-surface">${escapeHtml(h.value)}</span></div>`
    ).join('');

    container.innerHTML = `
      <div class="flex flex-col gap-3 font-mono text-xs select-text">
        <div class="border-b border-on-surface/20 pb-2">
          <div class="font-bold text-primary mb-1 uppercase">// GENERAL HTTP METADATA</div>
          <div>Request URL: <span class="text-on-surface">${escapeHtml(entry.request.url)}</span></div>
          <div>Request Method: <span class="font-bold text-secondary">${entry.request.method}</span></div>
          <div>Status Code: <span class="font-bold ${entry.response.status >= 400 ? 'text-primary' : 'text-secondary'}">${entry.response.status} ${entry.response.statusText || ''}</span></div>
          <div>Server IP: <span class="text-on-surface">${entry.serverIPAddress || 'unknown'}</span></div>
          <div>HTTP Version: <span class="text-on-surface">${entry.response.httpVersion || 'http/2.0'}</span></div>
        </div>
        <div class="border-b border-on-surface/20 pb-2">
          <div class="font-bold text-primary mb-1 uppercase">// RESPONSE HEADERS</div>
          ${resHeadersHtml || '<div class="text-on-surface-variant">None recorded</div>'}
        </div>
        <div>
          <div class="font-bold text-primary mb-1 uppercase">// REQUEST HEADERS</div>
          ${reqHeadersHtml || '<div class="text-on-surface-variant">None recorded</div>'}
        </div>
      </div>
    `;
  } else if (state.selectedHarSubtab === 'payload') {
    const postData = entry.request.postData;
    let content = 'No request payload';
    if (postData) {
      if (postData.text) {
        try {
          const parsed = JSON.parse(postData.text);
          content = JSON.stringify(parsed, null, 2);
        } catch (e) {
          content = postData.text;
        }
      }
    }
    container.innerHTML = `
      <pre class="font-mono text-xs text-on-surface select-text leading-relaxed whitespace-pre-wrap">${escapeHtml(content)}</pre>
    `;
  } else if (state.selectedHarSubtab === 'response') {
    const resContent = entry.response.content;
    let body = 'No response body recorded';
    if (resContent && resContent.text) {
      try {
        const parsed = JSON.parse(resContent.text);
        body = JSON.stringify(parsed, null, 2);
      } catch (e) {
        body = resContent.text;
      }
    }
    container.innerHTML = `
      <pre class="font-mono text-xs text-on-surface select-text leading-relaxed whitespace-pre-wrap">${escapeHtml(body)}</pre>
    `;
  }
}

// --- Render Engine ---
function render() {
  const root = document.getElementById('app-root');
  if (!root) return;

  // Build the complete Bauhaus Shell
  root.innerHTML = `
    <div class="app-container">
      <!-- SIDEBAR -->
      <aside class="sidebar select-none">
        <div>
          <!-- Brand Header -->
          <div class="sidebar-header">
            <div class="brand-badge">
              <div class="brand-circle"></div>
              <div class="brand-square"></div>
              <div class="brand-triangle"></div>
              <span class="brand-title">RRWEB // BAUHAUS</span>
            </div>
          </div>
          <!-- Project Archive Card -->
          <div class="project-badge">
            <div class="font-display text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">PROJECT ARCHIVE</div>
            <div class="font-display text-sm font-bold text-on-surface uppercase tracking-tight flex items-center justify-between mt-1">
              <span>PRJ-TELEM-09</span>
              <span class="material-symbols-outlined text-[16px]">unfold_more</span>
            </div>
          </div>
          <!-- Nav Items -->
          <nav class="flex flex-col">
            <a class="nav-item ${state.activeTab === 'sessions' ? 'active' : ''}" data-tab="sessions">
              <span class="nav-num">01</span>
              <span class="material-symbols-outlined nav-icon">play_circle</span>
              <span>Sessions</span>
            </a>
            <a class="nav-item ${state.activeTab === 'replayer' ? 'active' : ''}" data-tab="replayer">
              <span class="nav-num">02</span>
              <span class="material-symbols-outlined nav-icon">view_in_ar</span>
              <span>Replayer</span>
            </a>
            <a class="nav-item ${state.activeTab === 'timeline' ? 'active' : ''}" data-tab="timeline">
              <span class="nav-num">03</span>
              <span class="material-symbols-outlined nav-icon">waterfall_chart</span>
              <span>Timeline</span>
            </a>
            <a class="nav-item ${state.activeTab === 'engine' ? 'active' : ''}" data-tab="engine">
              <span class="nav-num">04</span>
              <span class="material-symbols-outlined nav-icon">settings_input_component</span>
              <span>Engine &amp; Hub</span>
            </a>
            <a class="nav-item ${state.activeTab === 'spans' ? 'active' : ''}" data-tab="spans">
              <span class="nav-num">05</span>
              <span class="material-symbols-outlined nav-icon">conversion_path</span>
              <span>Spans &amp; Mutations</span>
            </a>
          </nav>
        </div>
        <!-- Sidebar Footer -->
        <div class="sidebar-footer">
          <div class="flex items-center justify-between">
            <span class="font-display text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">RRWEB CORE</span>
            <span id="sidebar-rec-badge" class="px-1.5 py-0.5 font-display text-[10px] font-bold uppercase" style="background-color: var(--primary); color: #fff;">
              REC ACTIVE
            </span>
          </div>
          <div id="sidebar-buffer-stat" class="font-display text-[10px] text-on-surface-variant uppercase tracking-wider">
            BUFFER: 104.2 MB // EMIT 60Hz
          </div>
        </div>
      </aside>

      <!-- MAIN WRAPPER -->
      <div class="main-wrapper">
        <!-- TOP HEADER -->
        <header class="top-header select-none">
          <nav class="top-tabs">
            <a class="top-tab ${state.activeTab === 'sessions' ? 'active' : ''}" data-tab="sessions">01 SESSIONS</a>
            <a class="top-tab ${state.activeTab === 'replayer' ? 'active' : ''}" data-tab="replayer">02 REPLAYER</a>
            <a class="top-tab ${state.activeTab === 'timeline' ? 'active' : ''}" data-tab="timeline">03 TIMELINE</a>
            <a class="top-tab ${state.activeTab === 'engine' ? 'active' : ''}" data-tab="engine">04 ENGINE &amp; HUB</a>
            <a class="top-tab ${state.activeTab === 'spans' ? 'active' : ''}" data-tab="spans">05 SPANS</a>
          </nav>
          <div class="top-status">
            <div class="flex items-center gap-1.5">
              <span class="px-2 py-0.5 font-display text-[10px] font-bold uppercase" style="background-color: var(--tertiary-container); color: var(--on-tertiary-container);">
                BUFFER SYNC
              </span>
              <span id="top-rec-badge" class="px-2 py-0.5 font-display text-[10px] font-bold uppercase" style="background-color: var(--primary); color: #fff;">
                RECORDING
              </span>
            </div>
            <div class="w-8 h-8 rounded-full flex items-center justify-center border-2 border-on-surface" style="background-color: var(--primary); border-radius: 50% !important;">
              <span class="material-symbols-outlined text-[18px] text-white">person</span>
            </div>
          </div>
        </header>

        <!-- VIEW CONTAINER -->
        <main id="tab-view-container" class="w-full flex-1">
          ${renderActiveTab()}
        </main>
      </div>

      <!-- TOAST CONTAINER -->
      <div id="toast-container"></div>
    </div>
  `;

  attachEventHandlers();
  updateSidebarFooter();
  updateTopBarStatus();
}

function renderActiveTab() {
  switch (state.activeTab) {
    case 'sessions': return renderSessionsLedgerTab();
    case 'replayer': return renderReplayerTab();
    case 'timeline': return renderTimelineTab();
    case 'engine': return renderEngineStorageHubTab();
    case 'spans': return renderSpansMutationsTab();
    default: return renderSessionsLedgerTab();
  }
}

// ==========================================
// TAB 01: SESSIONS LEDGER
// ==========================================
function renderSessionsLedgerTab() {
  const totalCount = state.sessions.length;
  let totalRequests = 0;
  let totalDuration = 0;

  state.sessions.forEach(s => {
    if (s.har && s.har.log && s.har.log.entries) {
      totalRequests += s.har.log.entries.length;
    }
  });

  const filteredSessions = state.sessions.filter(s => {
    if (!state.harFilter) return true;
    const q = state.harFilter.toLowerCase();
    return (s.name && s.name.toLowerCase().includes(q)) ||
           (s.id && s.id.toLowerCase().includes(q));
  });

  const rowsHtml = filteredSessions.map(s => {
    const isSelected = state.selectedSessionIds.has(s.id);
    const dateStr = s.createTimestamp ? new Date(s.createTimestamp).toLocaleString() : 'Recent';
    const reqCount = (s.har && s.har.log && s.har.log.entries) ? s.har.log.entries.length : 0;
    const estSize = formatBytes(JSON.stringify(s).length);

    return `
      <tr class="hover:bg-surface-container-high transition-none cursor-pointer ${isSelected ? 'selected' : ''}" data-session-id="${s.id}">
        <td class="w-10 text-center">
          <input type="checkbox" class="session-checkbox cursor-pointer" data-id="${s.id}" ${isSelected ? 'checked' : ''} />
        </td>
        <td class="w-24">
          <span class="status-badge status-200">SAVED</span>
        </td>
        <td class="font-bold">
          <div class="text-on-surface font-display text-sm">${escapeHtml(s.name || 'Untitled Session')}</div>
          <div class="font-mono text-[11px] text-on-surface-variant">#${s.id}</div>
        </td>
        <td class="font-mono text-xs">
          <span class="px-1.5 py-0.5 bg-surface border border-on-surface font-bold text-secondary">${reqCount} REQS</span>
        </td>
        <td class="font-mono text-xs">${estSize}</td>
        <td class="font-mono text-xs text-on-surface-variant">${dateStr}</td>
        <td class="w-64">
          <div class="flex items-center gap-1.5">
            <button class="btn-bauhaus btn-bauhaus-secondary text-[10px] py-1 px-2 btn-play-session" data-id="${s.id}">
              <span class="material-symbols-outlined text-[14px]">play_arrow</span> REPLAY
            </button>
            <button class="btn-bauhaus btn-bauhaus-tertiary text-[10px] py-1 px-2 btn-json-session" data-id="${s.id}">
              JSON
            </button>
            ${s.har ? `
              <button class="btn-bauhaus btn-bauhaus-primary text-[10px] py-1 px-2 btn-har-session" data-id="${s.id}">
                HAR
              </button>
            ` : ''}
            <button class="btn-bauhaus btn-bauhaus-dark text-[10px] py-1 px-2 btn-del-session" data-id="${s.id}">
              DEL
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="p-6 flex flex-col gap-6">
      <!-- SUMMARY RIBBON CARDS -->
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div class="ribbon-card">
          <span class="font-display text-[10px] font-bold uppercase tracking-widest text-on-surface-variant block">TOTAL SAVED SESSIONS</span>
          <span class="font-display text-2xl font-bold text-on-surface mt-1 block">${totalCount} ARCHIVES</span>
          <div class="w-full bg-surface-container-high h-2 border border-on-surface mt-2">
            <div class="h-full bg-secondary" style="width: ${Math.min(100, totalCount * 10)}%"></div>
          </div>
        </div>
        <div class="ribbon-card">
          <span class="font-display text-[10px] font-bold uppercase tracking-widest text-secondary block">INDEXED STORAGE</span>
          <span class="font-display text-2xl font-bold text-on-surface mt-1 block">${formatBytes(state.storageEstimate.usage || 0)}</span>
          <div class="w-full bg-surface-container-high h-2 border border-on-surface mt-2">
            <div class="h-full bg-tertiary-container" style="width: 42%"></div>
          </div>
        </div>
        <div class="ribbon-card">
          <span class="font-display text-[10px] font-bold uppercase tracking-widest text-primary block">TOTAL HAR REQUESTS</span>
          <span class="font-display text-2xl font-bold text-on-surface mt-1 block">${totalRequests} CALLS</span>
          <div class="w-full bg-surface-container-high h-2 border border-on-surface mt-2">
            <div class="h-full bg-primary" style="width: ${Math.min(100, totalRequests * 5)}%"></div>
          </div>
        </div>
        <div class="ribbon-card" style="background-color: var(--inverse-surface); color: var(--inverse-on-surface);">
          <span class="font-display text-[10px] font-bold uppercase tracking-widest text-tertiary-fixed block">SYSTEM STATUS</span>
          <div class="flex items-center justify-between mt-1">
            <span class="font-display text-2xl font-bold text-white uppercase tracking-tight">ONLINE</span>
            <span class="material-symbols-outlined text-secondary text-[28px]">verified</span>
          </div>
          <span class="font-display text-[10px] text-tertiary-fixed block mt-2">CDP RECORDER SYNCHRONIZED</span>
        </div>
      </div>

      <!-- FILTER & BULK CONTROLS -->
      <div class="bg-surface-container-lowest border-2 border-on-surface p-4 flex flex-wrap items-center justify-between gap-4 shadow-tectonic-sm">
        <div class="flex-1 min-w-[280px]">
          <input id="sessions-filter-input" type="text" class="input-bauhaus w-full" placeholder="FILTER SESSIONS BY NAME / ID..." value="${escapeHtml(state.harFilter)}" />
        </div>
        <div class="flex items-center gap-2">
          <button id="btn-bulk-delete" class="btn-bauhaus btn-bauhaus-primary">
            <span class="material-symbols-outlined text-[16px]">delete</span> [ DELETE SELECTED ]
          </button>
          <button id="btn-bulk-export" class="btn-bauhaus btn-bauhaus-tertiary">
            <span class="material-symbols-outlined text-[16px]">file_download</span> [ EXPORT ALL ]
          </button>
          <button id="btn-create-recording" class="btn-bauhaus btn-bauhaus-secondary">
            <span class="material-symbols-outlined text-[16px]">fiber_manual_record</span> [ DISPATCH REC ]
          </button>
        </div>
      </div>

      <!-- SESSIONS TABLE -->
      <div class="bg-surface-container-lowest border-2 border-on-surface shadow-tectonic overflow-x-auto">
        <table class="bauhaus-table">
          <thead>
            <tr>
              <th class="w-10 text-center"><input type="checkbox" id="select-all-sessions" /></th>
              <th class="w-24">STATUS</th>
              <th>SESSION IDENTIFIER &amp; TARGET</th>
              <th>NETWORK HAR</th>
              <th>SIZE</th>
              <th>RECORDED TIMESTAMP</th>
              <th class="w-64">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || `<tr><td colspan="7" class="p-8 text-center text-on-surface-variant font-mono">NO RECORDED SESSIONS DETECTED IN STORAGE. CLICK "DISPATCH REC" OR USE THE EXTENSION POPUP TO RECORD.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ==========================================
// TAB 02: DEVTOOLS REPLAYER WORKBENCH (VARIANT 2)
// ==========================================
function renderReplayerTab() {
  const session = state.activeSession || state.sessions[0];
  const entries = state.activeHarEntries || [];

  const filterType = state.harTypeFilter;
  const filterQuery = (state.harFilter || '').toLowerCase();

  const filteredEntries = entries.filter(e => {
    if (filterType !== 'ALL') {
      const type = (e._resourceType || '').toLowerCase();
      if (filterType === 'XHR/FETCH' && !['xhr', 'fetch'].includes(type)) return false;
      if (filterType === 'WS' && type !== 'websocket') return false;
      if (filterType === 'JS/CSS' && !['script', 'stylesheet'].includes(type)) return false;
      if (filterType === 'MEDIA' && !['image', 'media', 'font'].includes(type)) return false;
    }
    if (filterQuery) {
      return e.request.url.toLowerCase().includes(filterQuery) ||
             String(e.response.status).includes(filterQuery) ||
             e.request.method.toLowerCase().includes(filterQuery);
    }
    return true;
  });

  const harRowsHtml = filteredEntries.map((e, idx) => {
    const isSelected = idx === state.selectedHarIndex;
    const status = e.response.status;
    let statusClass = 'status-200';
    if (status >= 500) statusClass = 'status-500';
    else if (status >= 400) statusClass = 'status-400';
    else if (status >= 300) statusClass = 'status-300';

    const url = new URL(e.request.url);
    const shortName = url.pathname.split('/').pop() || url.pathname || '/';
    const sizeStr = formatBytes(e.response.content?.size || e.response.bodySize || 0);

    const timePct = Math.min(100, Math.max(10, ((e.time || 50) / 1000) * 100));

    return `
      <tr class="hover:bg-surface-container-high transition-none cursor-pointer ${isSelected ? 'selected' : ''}" data-har-index="${idx}">
        <td class="w-16"><span class="status-badge ${statusClass}">${status} ${e.response.statusText ? e.response.statusText.slice(0, 4).toUpperCase() : 'OK'}</span></td>
        <td class="truncate max-w-[140px] font-medium text-on-surface" title="${escapeHtml(e.request.url)}">${escapeHtml(shortName)}</td>
        <td class="w-16 font-bold ${status >= 400 ? 'text-primary' : 'text-on-surface'}">${e.request.method}</td>
        <td class="w-20 text-on-surface-variant">${sizeStr}</td>
        <td class="w-40 pr-2">
          <div class="w-full h-3 bg-surface-container border border-on-surface relative">
            <div class="h-full ${status >= 400 ? 'bg-primary' : 'bg-secondary'}" style="width: ${timePct}%;"></div>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="flex flex-col w-full min-h-[calc(100vh-64px)]">
      <!-- TOP CONSTRUCTIVIST CONTROL BAR -->
      <header class="w-full bg-surface-container-lowest border-b-2 border-on-surface flex flex-wrap items-stretch justify-between select-none">
        <div class="flex items-stretch flex-wrap">
          <div class="bg-primary text-white px-4 py-2 flex items-center gap-2 border-r-2 border-on-surface">
            <span class="font-display text-xs font-bold uppercase tracking-wider">HAR // REPLAYER</span>
            <span class="inline-block w-2.5 h-2.5 bg-tertiary-container border border-on-surface"></span>
          </div>
          <button id="btn-inspect-mode" class="btn-bauhaus border-r-2 border-on-surface flex items-center gap-2">
            <span class="w-3 h-3 bg-secondary inline-block"></span>
            <span>Inspect DOM</span>
          </button>
          <button id="btn-sync-toggle" class="btn-bauhaus border-r-2 border-on-surface flex items-center gap-2">
            <span class="material-symbols-outlined text-[16px] text-primary">sync_alt</span>
            <span>Sync HAR/DOM</span>
          </button>
          <button id="btn-export-session-har" class="btn-bauhaus btn-bauhaus-primary border-r-2 border-on-surface flex items-center gap-2">
            <span class="material-symbols-outlined text-[16px]">file_download</span>
            <span>Export .HAR Archive</span>
          </button>
        </div>
        <div class="flex items-stretch flex-wrap border-l-2 border-on-surface bg-surface-container-low">
          <div class="px-4 py-2 border-r-2 border-on-surface flex items-center gap-2">
            <span class="font-display text-[10px] font-bold uppercase text-on-surface-variant">SESSION KEY</span>
            <span class="font-display text-xs font-bold text-on-surface bg-surface px-1.5 py-0.5 border border-on-surface">#${session ? session.id.slice(0, 8) : '0x9F1A'}</span>
          </div>
          <div class="px-4 py-2 border-r-2 border-on-surface flex items-center gap-2">
            <span class="font-display text-[10px] font-bold uppercase text-on-surface-variant">TARGET</span>
            <span class="font-display text-xs text-secondary font-bold uppercase truncate max-w-[200px]">${escapeHtml(session ? session.name : 'fintech_core.v2')}</span>
          </div>
          <div class="px-4 py-2 flex items-center gap-1.5 bg-surface-container-highest">
            <span class="material-symbols-outlined text-[16px]">aspect_ratio</span>
            <span class="font-display text-[11px] font-bold">1440 × 900 DP</span>
          </div>
        </div>
      </header>

      <!-- MAIN WORKBENCH: 60% REPLAYER / 40% DEVTOOLS ASYMMETRICAL TECTONIC SPLIT -->
      <div class="w-full grid grid-cols-1 xl:grid-cols-12 flex-1">
        <!-- LEFT PANEL: THEATER / RRWEB REPLAYER VIEWPORT (60% -> col-span-7) -->
        <section class="xl:col-span-7 bg-surface-container-low border-r-2 border-b-2 xl:border-b-0 border-on-surface flex flex-col justify-between">
          <!-- Studio Header Bar -->
          <div class="bg-surface-container-high border-b-2 border-on-surface p-2 px-4 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="w-3 h-3 bg-primary border border-on-surface inline-block"></span>
              <span class="font-display text-xs font-bold uppercase tracking-wider text-on-surface">REPLAY STAGE // CANVAS RECT</span>
            </div>
            <div class="flex items-center gap-1.5 font-display text-[10px] font-bold">
              <span class="px-2 py-0.5 bg-surface border border-on-surface uppercase">FPS: 60.1</span>
              <span class="px-2 py-0.5 bg-primary text-white uppercase font-bold">MUTATION EV: ${state.activeEvents ? state.activeEvents.length : 0}</span>
            </div>
          </div>

          <!-- Synthetic Browser Frame with 3px Bauhaus Outline -->
          <div class="relative p-4 xl:p-6 flex-1 flex flex-col items-center justify-center bg-[#eae6e5]">
            <div class="relative w-full max-w-[860px] aspect-[16/10] bg-surface-container-lowest border-[3px] border-on-surface flex flex-col overflow-hidden shadow-tectonic">
              <!-- Mock Browser Chromeworks -->
              <div class="h-8 bg-surface-container-highest border-b-2 border-on-surface flex items-center justify-between px-3 select-none">
                <div class="flex items-center gap-1.5">
                  <span class="w-3 h-3 bg-primary border border-on-surface inline-block"></span>
                  <span class="w-3 h-3 bg-tertiary-container border border-on-surface inline-block"></span>
                  <span class="w-3 h-3 bg-secondary border border-on-surface inline-block"></span>
                </div>
                <div class="bg-surface px-4 py-0.5 border border-on-surface font-display text-[11px] text-on-surface-variant truncate max-w-[480px]">
                  ${escapeHtml(session ? session.name : 'https://app.fintechcore.io/checkout/invoice')}
                </div>
                <div class="flex items-center gap-1">
                  <span class="material-symbols-outlined text-[16px]">lock</span>
                  <span class="material-symbols-outlined text-[16px]">security</span>
                </div>
              </div>

              <!-- Replay Target Viewport -->
              <div id="rrweb-stage-canvas" class="relative w-full flex-1 bg-surface-container-lowest overflow-hidden flex items-center justify-center">
                ${!state.activeSession ? '<div class="font-display font-bold uppercase text-on-surface-variant text-sm">SELECT A SESSION TO INITIALIZE REPLAY STAGE</div>' : ''}
              </div>
            </div>
          </div>

          <!-- BAUHAUS MECHANICAL PLAYBACK BAR & SCRUBBER -->
          <div class="w-full bg-surface-container-lowest border-t-2 border-on-surface p-4 flex flex-col gap-2 select-none">
            <!-- Scrubber Track & Markers -->
            <div class="flex items-center gap-4">
              <span id="time-current" class="font-display text-xs font-bold uppercase text-on-surface-variant shrink-0 w-16">00:00.00</span>
              <div id="scrubber-track" class="scrubber-track flex-1 flex items-center">
                <div id="scrubber-fill" class="scrubber-fill w-[0%]"></div>
                <div id="scrubber-thumb" class="scrubber-thumb left-[0%]"></div>
              </div>
              <span id="time-total" class="font-display text-xs font-bold uppercase text-on-surface-variant shrink-0 w-16 text-right">00:00.00</span>
            </div>

            <!-- Controls Row: Play/Pause, Step, Speed Tiles -->
            <div class="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div class="flex items-center gap-2">
                <button id="btn-play-pause" class="w-12 h-12 bg-on-surface border-2 border-on-surface flex items-center justify-center hover:bg-secondary transition-none" title="Toggle Play/Pause [Space]">
                  <span class="w-6 h-6 rounded-full bg-primary border border-on-surface flex items-center justify-center" style="border-radius: 50% !important;">
                    <span class="material-symbols-outlined text-white text-[16px]">play_arrow</span>
                  </span>
                </button>
                <button id="btn-step-back" class="btn-bauhaus w-10 h-10 p-0" title="Step Back 100ms">
                  <span class="material-symbols-outlined text-[18px]">skip_previous</span>
                </button>
                <button id="btn-step-forward" class="btn-bauhaus w-10 h-10 p-0" title="Step Forward 100ms">
                  <span class="material-symbols-outlined text-[18px]">skip_next</span>
                </button>
                <div class="h-6 w-[2px] bg-on-surface mx-1"></div>
                <button id="btn-skip-inactive" class="btn-bauhaus text-xs">
                  <span class="material-symbols-outlined text-[16px]">fast_forward</span> Skip Inactivity
                </button>
              </div>

              <!-- Speed Variation Stark Tiles -->
              <div class="flex items-center border-2 border-on-surface">
                <span class="px-2 py-1 font-display text-[11px] font-bold uppercase bg-surface-container-high border-r-2 border-on-surface">SPEED</span>
                <button class="btn-speed-tile px-2 py-1 font-display text-[11px] font-bold uppercase bg-surface border-r-2 border-on-surface" data-speed="0.5">0.5×</button>
                <button class="btn-speed-tile px-2 py-1 font-display text-[11px] font-bold uppercase bg-on-surface text-white border-r-2 border-on-surface" data-speed="1.0" style="background-color: var(--on-surface); color: #fff;">1.0×</button>
                <button class="btn-speed-tile px-2 py-1 font-display text-[11px] font-bold uppercase bg-surface border-r-2 border-on-surface" data-speed="2.0">2.0×</button>
                <button class="btn-speed-tile px-2 py-1 font-display text-[11px] font-bold uppercase bg-surface" data-speed="4.0">4.0×</button>
              </div>

              <!-- Direct Frame Indexing -->
              <div class="flex items-center gap-1.5 font-mono text-xs text-on-surface-variant">
                <span>FRAME:</span>
                <span id="frame-counter" class="bg-surface px-1.5 py-0.5 border border-on-surface font-bold text-on-surface">#00,001</span>
              </div>
            </div>
          </div>
        </section>

        <!-- RIGHT PANEL: DEVTOOLS HAR & STATE DIAGNOSTIC PANE (40% -> col-span-5) -->
        <section class="xl:col-span-5 bg-surface-container-lowest flex flex-col justify-between border-t-2 xl:border-t-0 border-on-surface">
          <!-- Bauhaus Multi-Tab Diagnostic Header -->
          <nav class="w-full bg-surface-container-low border-b-2 border-on-surface flex flex-wrap items-stretch select-none">
            <button class="flex-1 py-2 px-2 bg-secondary text-white font-display text-xs font-bold uppercase tracking-wider border-r-2 border-on-surface flex items-center justify-center gap-1">
              <span>01 NETWORK [HAR]</span>
              <span class="w-2 h-2 bg-primary"></span>
            </button>
            <button class="flex-1 py-2 px-2 bg-surface hover:bg-surface-variant text-on-surface font-display text-xs font-bold uppercase tracking-wider border-r-2 border-on-surface flex items-center justify-center gap-1 transition-none">
              <span>02 CONSOLE</span>
              <span class="px-1 bg-primary text-white text-[10px]">0!</span>
            </button>
            <button class="flex-1 py-2 px-2 bg-surface hover:bg-surface-variant text-on-surface font-display text-xs font-bold uppercase tracking-wider border-r-2 border-on-surface flex items-center justify-center transition-none">
              <span>03 MUTATIONS</span>
            </button>
            <button class="flex-1 py-2 px-2 bg-surface hover:bg-surface-variant text-on-surface font-display text-xs font-bold uppercase tracking-wider flex items-center justify-center transition-none">
              <span>04 TIMELINE</span>
            </button>
          </nav>

          <!-- Filter & Search Bar -->
          <div class="p-2 bg-surface-container-high border-b-2 border-on-surface flex items-center justify-between gap-2">
            <div class="flex-1">
              <input id="har-filter-input" class="input-bauhaus w-full h-8 text-xs" placeholder="FILTER HAR PATH / STATUS / CONTENT..." value="${escapeHtml(state.harFilter)}" />
            </div>
            <div class="flex items-center gap-1 font-display text-[10px] font-bold uppercase">
              <button class="btn-har-filter px-1.5 py-1 border border-on-surface ${filterType === 'ALL' ? 'bg-on-surface text-white' : 'bg-surface'}" data-type="ALL">ALL</button>
              <button class="btn-har-filter px-1.5 py-1 border border-on-surface ${filterType === 'XHR/FETCH' ? 'bg-on-surface text-white' : 'bg-surface'}" data-type="XHR/FETCH">XHR/FETCH</button>
              <button class="btn-har-filter px-1.5 py-1 border border-on-surface ${filterType === 'WS' ? 'bg-on-surface text-white' : 'bg-surface'}" data-type="WS">WS</button>
            </div>
          </div>

          <!-- HAR WATERFALL TABLE -->
          <div class="flex-1 overflow-x-auto min-h-[260px] max-h-[380px] bg-surface-container-lowest">
            <table class="bauhaus-table">
              <thead>
                <tr>
                  <th class="w-16">STATUS</th>
                  <th>NAME / RESOURCE</th>
                  <th class="w-16">METHOD</th>
                  <th class="w-20">SIZE</th>
                  <th class="w-40">WATERFALL LATENCY</th>
                </tr>
              </thead>
              <tbody id="har-table-body" class="font-mono text-xs">
                ${harRowsHtml || `<tr><td colspan="5" class="p-6 text-center text-on-surface-variant">NO CDP HAR ENTRIES AVAILABLE FOR THIS SESSION.</td></tr>`}
              </tbody>
            </table>
          </div>

          <!-- LOWER SUB-PANEL: RAW JSON PAYLOAD & HEADER VIEWER -->
          <div class="border-t-2 border-on-surface flex flex-col bg-surface-container-lowest">
            <div class="bg-on-surface text-white px-3 py-1 flex items-center justify-between select-none">
              <div class="flex items-center gap-2">
                <span class="w-2.5 h-2.5 bg-primary"></span>
                <span id="har-inspector-title" class="font-display text-[11px] font-bold uppercase tracking-wider text-white">HAR ENTRY INSPECTION</span>
              </div>
              <div class="flex items-center gap-1 font-display text-[10px] font-bold uppercase">
                <button class="btn-inspector-tab px-1.5 py-0.5 ${state.selectedHarSubtab === 'headers' ? 'bg-primary text-white' : 'bg-surface-container-highest text-on-surface'}" data-subtab="headers">Headers</button>
                <button class="btn-inspector-tab px-1.5 py-0.5 ${state.selectedHarSubtab === 'payload' ? 'bg-primary text-white' : 'bg-surface-container-highest text-on-surface'}" data-subtab="payload">Payload</button>
                <button class="btn-inspector-tab px-1.5 py-0.5 ${state.selectedHarSubtab === 'response' ? 'bg-primary text-white' : 'bg-surface-container-highest text-on-surface'}" data-subtab="response">Response</button>
              </div>
            </div>
            <div id="har-inspector-content" class="p-3 bg-surface overflow-x-auto max-h-48 font-mono text-xs border-b-2 border-on-surface">
              <!-- Dynamically populated -->
            </div>
            <div class="p-1 px-3 bg-surface-container-high flex items-center justify-between font-display text-[10px] text-on-surface-variant font-bold">
              <div class="flex items-center gap-3">
                <span>HAR ENTRIES: ${entries.length}</span>
                <span>TOTAL SIZE: ${formatBytes(entries.reduce((acc, e) => acc + (e.response.content?.size || 0), 0))}</span>
              </div>
              <div class="flex items-center gap-1 text-on-surface uppercase">
                <span class="w-2 h-2 bg-secondary inline-block"></span>
                <span>DOM SYNCHRONIZED</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- TELEMETRY OVERVIEW RIBBON -->
      <footer class="w-full bg-surface-container-low border-t-2 border-on-surface p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="ribbon-card">
          <span class="font-display text-[10px] font-bold uppercase text-on-surface-variant block">TOTAL HAR REQUESTS</span>
          <span class="font-display text-xl font-bold text-on-surface mt-1 block">${entries.length} CALLS</span>
          <div class="w-full bg-surface-container-high h-2 border border-on-surface mt-1">
            <div class="bg-secondary h-full w-[85%]"></div>
          </div>
        </div>
        <div class="ribbon-card">
          <span class="font-display text-[10px] font-bold uppercase text-primary block">NETWORK EXCEPTIONS</span>
          <span class="font-display text-xl font-bold text-primary mt-1 block">${entries.filter(e => e.response.status >= 400).length} CRITICAL</span>
          <div class="w-full bg-surface-container-high h-2 border border-on-surface mt-1">
            <div class="bg-primary h-full w-[24%]"></div>
          </div>
        </div>
        <div class="ribbon-card">
          <span class="font-display text-[10px] font-bold uppercase text-tertiary-container block">DOM MUTATIONS</span>
          <span class="font-display text-xl font-bold text-on-surface mt-1 block">${state.activeEvents ? state.activeEvents.length : 0} CYCLES</span>
          <div class="w-full bg-surface-container-high h-2 border border-on-surface mt-1">
            <div class="bg-tertiary-container h-full w-[60%]"></div>
          </div>
        </div>
        <div class="ribbon-card" style="background-color: var(--inverse-surface); color: var(--inverse-on-surface);">
          <span class="font-display text-[10px] font-bold uppercase text-tertiary-fixed block">DIAGNOSTIC STATUS</span>
          <div class="flex items-center justify-between mt-1">
            <span class="font-display text-xl font-bold text-white uppercase tracking-tight">${entries.some(e => e.response.status >= 500) ? 'FATAL HALT' : 'NORMAL'}</span>
            <span class="material-symbols-outlined text-primary text-[24px]">gpp_maybe</span>
          </div>
          <span class="font-display text-[10px] text-tertiary-fixed block mt-1">CDP PROFILES ATTACHED</span>
        </div>
      </footer>
    </div>
  `;
}

// ==========================================
// TAB 03: TIMELINE WATERFALL
// ==========================================
function renderTimelineTab() {
  const entries = state.activeHarEntries || [];
  const events = state.activeEvents || [];

  return `
    <div class="p-6 flex flex-col gap-6">
      <div class="bg-surface-container-high border-2 border-on-surface p-4 flex items-center justify-between shadow-tectonic-sm">
        <div class="flex items-center gap-3">
          <span class="material-symbols-outlined text-secondary text-2xl">waterfall_chart</span>
          <div>
            <h2 class="font-display text-lg font-bold uppercase tracking-tight">SYNCHRONIZED TELEMETRY WATERFALL</h2>
            <p class="font-display text-xs text-on-surface-variant uppercase">Shared millisecond timeline: DOM mutations vs CDP network spans</p>
          </div>
        </div>
        <button class="btn-bauhaus btn-bauhaus-secondary" onclick="window.location.hash='#/replayer'">
          <span class="material-symbols-outlined text-sm">view_in_ar</span> REPLAYER WORKBENCH
        </button>
      </div>

      <div class="bg-surface-container-lowest border-2 border-on-surface p-6 shadow-tectonic">
        <div class="border-b-2 border-on-surface pb-3 mb-4 flex items-center justify-between">
          <span class="font-display font-bold uppercase text-xs">WATERFALL TIME STRATA (TOTAL: ${formatTime(state.totalDurationMs)})</span>
          <span class="font-mono text-xs font-bold text-secondary">${entries.length} NETWORK SPANS // ${events.length} DOM MUTATIONS</span>
        </div>

        <div class="flex flex-col gap-2">
          ${entries.slice(0, 20).map(e => {
            const status = e.response.status;
            const url = new URL(e.request.url);
            const timePct = Math.min(90, Math.max(5, ((e.time || 50) / 1000) * 100));
            return `
              <div class="flex items-center gap-4 py-1.5 border-b border-surface-variant font-mono text-xs">
                <span class="status-badge ${status >= 400 ? 'status-400' : 'status-200'} w-14 text-center">${status}</span>
                <span class="font-bold text-on-surface w-16">${e.request.method}</span>
                <span class="truncate w-64 text-on-surface" title="${escapeHtml(e.request.url)}">${escapeHtml(url.pathname)}</span>
                <div class="flex-1 h-4 bg-surface-container border border-on-surface relative">
                  <div class="h-full ${status >= 400 ? 'bg-primary' : 'bg-secondary'}" style="width: ${timePct}%;"></div>
                </div>
                <span class="w-20 text-right text-on-surface-variant">${(e.time || 0).toFixed(1)}ms</span>
              </div>
            `;
          }).join('') || '<div class="text-center p-8 text-on-surface-variant font-mono">NO SPANS TO DISPLAY. SELECT A SESSION WITH HAR DATA.</div>'}
        </div>
      </div>
    </div>
  `;
}

// ==========================================
// TAB 04: ENGINE & STORAGE HUB (VARIANT 4)
// ==========================================
function renderEngineStorageHubTab() {
  const isRec = state.recorderStatus.status === 'RECORDING';
  const allocatedMb = (state.storageEstimate.usage / (1024 * 1024)).toFixed(1);
  const quotaMb = (state.storageEstimate.quota / (1024 * 1024 * 1024)).toFixed(2);

  return `
    <div class="flex flex-col w-full">
      <!-- HEADER BANNER -->
      <div class="w-full bg-surface-container-high px-8 py-4 border-b-2 border-on-surface flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-4">
          <div class="w-8 h-8 bg-primary text-white flex items-center justify-center font-display text-base font-bold">04</div>
          <div class="flex flex-col">
            <span class="font-display text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">ENGINE &amp; COMPANION HUB // INDEXED-DB TIER 0</span>
            <span class="font-display text-xl font-bold uppercase tracking-tight text-on-surface">RECORDER EXTENSION &amp; VOLATILE STORAGE</span>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <div class="flex items-center bg-surface-container-lowest px-4 py-1.5 border-2 border-on-surface shadow-tectonic-xs">
            <span class="w-3 h-3 rounded-full bg-primary inline-block mr-2 ${isRec ? 'animate-pulse' : ''}" style="border-radius: 50% !important;"></span>
            <span class="font-display text-xs uppercase font-bold text-on-surface">CLIENT SYNC: ${isRec ? 'ATTACHED' : 'READY'}</span>
          </div>
          <div class="bg-inverse-surface text-inverse-on-surface px-4 py-1.5 font-display text-xs font-bold uppercase border border-on-surface">
            CHROMIUM 124.0.6367.60
          </div>
        </div>
      </div>

      <!-- MAIN 2-COLUMN HUB GRID -->
      <div class="w-full grid grid-cols-1 xl:grid-cols-12 gap-8 p-8">
        <!-- LEFT COLUMN: RECORDER EXTENSION COMPANION -->
        <div class="xl:col-span-5 flex flex-col gap-6">
          <div class="bg-surface-container-lowest border-2 border-on-surface shadow-tectonic flex flex-col overflow-hidden">
            <div class="bg-surface-container px-6 py-3 border-b-2 border-on-surface flex items-center justify-between">
              <div class="flex items-center gap-2">
                <div class="brand-circle"></div>
                <div class="brand-square"></div>
                <div class="brand-triangle"></div>
                <span class="font-display text-xs font-bold uppercase tracking-wider ml-1">RRWEB RECORDER // EXTENSION V2.1.6</span>
              </div>
              <div class="flex items-center gap-1">
                <span class="w-2.5 h-2.5 bg-on-surface inline-block"></span>
                <span class="w-2.5 h-2.5 bg-surface-variant inline-block"></span>
              </div>
            </div>

            <div class="p-6 flex flex-col gap-6">
              <!-- Target Tab Attachment -->
              <div class="bg-surface-container-low border-2 border-on-surface p-3 flex items-center justify-between">
                <div class="flex flex-col min-w-0 pr-2">
                  <span class="font-display text-[10px] font-bold uppercase text-on-surface-variant">TARGET TAB ATTACHMENT</span>
                  <div class="flex items-center gap-2 mt-1 truncate">
                    <span class="font-mono text-xs bg-inverse-surface text-inverse-on-surface px-1.5 py-0.5">#${state.recorderStatus.activeTabId || 'ACTIVE'}</span>
                    <span class="font-body text-xs font-bold truncate">Current Active Browser Tab</span>
                  </div>
                </div>
                <div class="bg-tertiary-container text-on-tertiary-container px-2 py-1 font-display text-[10px] font-bold uppercase shadow-tectonic-xs">
                  ${isRec ? 'ACTIVE HOOK' : 'STANDBY'}
                </div>
              </div>

              <!-- Master Dispatch Circle Button -->
              <div class="flex flex-col items-center justify-center py-6 bg-surface-container-low border-2 border-on-surface relative">
                <div class="absolute top-3 left-3 font-display text-[10px] font-bold uppercase text-on-surface-variant tracking-widest">[ MASTER DISPATCH ]</div>
                <div id="trigger-container" class="relative w-44 h-44 rounded-full bg-tertiary-container flex items-center justify-center border-2 border-on-surface shadow-tectonic-md my-2 cursor-pointer transition-transform active:scale-95" style="border-radius: 50% !important;">
                  <button id="hub-recording-btn" class="relative z-10 w-24 h-24 ${isRec ? 'bg-inverse-surface' : 'bg-primary'} text-white flex flex-col items-center justify-center border-2 border-on-surface shadow-tectonic-xs cursor-pointer" style="border-radius: 50% !important;">
                    <span class="material-symbols-outlined text-4xl">${isRec ? 'stop' : 'fiber_manual_record'}</span>
                    <span class="font-display text-[10px] font-bold uppercase tracking-widest mt-1">${isRec ? 'HALT' : 'ARMED'}</span>
                  </button>
                </div>
                <div class="mt-3 flex flex-col items-center">
                  <span id="session-clock" class="font-display text-4xl font-bold tracking-tight text-on-surface font-mono">00:00:00</span>
                  <span class="font-display text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mt-1">STREAMING CHUNK EMISSION // 60 FPS</span>
                </div>
              </div>

              <!-- Masking Presets -->
              <div class="flex flex-col gap-2">
                <div class="flex items-center justify-between">
                  <span class="font-display text-xs font-bold uppercase tracking-wider">DOM PRIVACY / MASKING PRESET</span>
                  <span class="font-display text-[10px] font-bold uppercase text-secondary">MUTATION LEVEL</span>
                </div>
                <div class="grid grid-cols-3 gap-2">
                  <button class="btn-bauhaus btn-bauhaus-dark font-bold text-center py-2 text-xs" data-preset="strict">[ STRICT ]</button>
                  <button class="btn-bauhaus bg-surface-container-high text-center py-2 text-xs" data-preset="inputs">INPUTS ONLY</button>
                  <button class="btn-bauhaus bg-surface-container-high text-center py-2 text-xs" data-preset="fidelity">FULL FIDELITY</button>
                </div>
              </div>

              <!-- Concurrency Toggles -->
              <div class="grid grid-cols-2 gap-4">
                <div class="bg-surface-container-low border-2 border-on-surface p-3 flex flex-col justify-between">
                  <div class="flex items-center justify-between">
                    <span class="font-display text-[10px] font-bold uppercase">AUDIO CONCURRENT</span>
                    <span class="material-symbols-outlined text-lg text-secondary">mic</span>
                  </div>
                  <div class="flex items-center justify-between mt-3">
                    <span class="font-display text-[10px] text-on-surface-variant uppercase">PCM 48kHz</span>
                    <span class="chip-bauhaus bg-secondary text-white">ON</span>
                  </div>
                </div>
                <div class="bg-surface-container-low border-2 border-on-surface p-3 flex flex-col justify-between">
                  <div class="flex items-center justify-between">
                    <span class="font-display text-[10px] font-bold uppercase">MOUSE TRACKER</span>
                    <span class="material-symbols-outlined text-lg text-primary">near_me</span>
                  </div>
                  <div class="flex items-center justify-between mt-3">
                    <span class="font-display text-[10px] text-on-surface-variant uppercase">COORDS + VEL</span>
                    <span class="chip-bauhaus bg-primary text-white">ON</span>
                  </div>
                </div>
              </div>

              <!-- Hotkey Badge -->
              <div class="bg-surface-container border-2 border-on-surface flex items-center justify-between p-2 px-3">
                <div class="flex items-center gap-2">
                  <span class="material-symbols-outlined text-sm">keyboard</span>
                  <span class="font-display text-xs font-bold uppercase">TRIGGER HOTKEY</span>
                </div>
                <div class="bg-tertiary-container text-on-tertiary-container px-2 py-0.5 font-mono text-xs font-bold shadow-tectonic-xs">
                  [ ALT + SHIFT + R ]
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- RIGHT COLUMN: STORAGE & EXPORT OPERATIONS -->
        <div class="xl:col-span-7 flex flex-col gap-6">
          <div class="bg-surface-container-lowest border-2 border-on-surface shadow-tectonic flex flex-col">
            <!-- Quota Header -->
            <div class="bg-inverse-surface text-inverse-on-surface px-6 py-3 border-b-2 border-on-surface flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="material-symbols-outlined text-xl text-tertiary-fixed">dataset</span>
                <span class="font-display text-xs font-bold uppercase tracking-wider text-white">INDEXED-DB PARTITION // QUOTA ALLOCATION</span>
              </div>
              <span class="font-mono text-xs uppercase bg-primary text-white px-2 py-0.5 font-bold">
                ${allocatedMb} MB / ${quotaMb} GB ALLOCATED
              </span>
            </div>

            <div class="p-6 flex flex-col gap-6">
              <!-- Segment Consumption Blueprint -->
              <div class="flex flex-col gap-2">
                <div class="flex justify-between items-end">
                  <span class="font-display text-xs font-bold uppercase">SEGMENT CONSUMPTION BLUEPRINT</span>
                  <span class="font-mono text-xs text-on-surface-variant">UTILIZATION: 42.13%</span>
                </div>
                <div class="h-10 w-full flex bg-surface-container border-2 border-on-surface overflow-hidden shadow-tectonic-xs">
                  <div class="h-full bg-secondary flex items-center justify-center text-white font-display text-[11px] font-bold" style="width: 52%;">
                    52% DOM SNAPSHOTS
                  </div>
                  <div class="h-full bg-tertiary-container flex items-center justify-center text-on-tertiary-container font-display text-[11px] font-bold" style="width: 32%;">
                    32% HAR TRACES
                  </div>
                  <div class="h-full bg-primary flex items-center justify-center text-white font-display text-[11px] font-bold" style="width: 16%;">
                    16% CANVAS
                  </div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2">
                  <div class="bg-surface-container-low border border-on-surface p-2 flex items-center gap-2">
                    <div class="w-3 h-3 bg-secondary shrink-0"></div>
                    <div class="flex flex-col min-w-0 font-mono text-[11px]">
                      <span class="font-bold text-on-surface">DOM Mutations</span>
                      <span class="text-on-surface-variant">${state.sessions.length * 120} ev</span>
                    </div>
                  </div>
                  <div class="bg-surface-container-low border border-on-surface p-2 flex items-center gap-2">
                    <div class="w-3 h-3 bg-tertiary-container shrink-0"></div>
                    <div class="flex flex-col min-w-0 font-mono text-[11px]">
                      <span class="font-bold text-on-surface">Network Traces</span>
                      <span class="text-on-surface-variant">${state.sessions.reduce((acc, s) => acc + (s.har?.log?.entries?.length || 0), 0)} req</span>
                    </div>
                  </div>
                  <div class="bg-surface-container-low border border-on-surface p-2 flex items-center gap-2">
                    <div class="w-3 h-3 bg-primary shrink-0"></div>
                    <div class="flex flex-col min-w-0 font-mono text-[11px]">
                      <span class="font-bold text-on-surface">Canvas / WebGL</span>
                      <span class="text-on-surface-variant">Active Sync</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Storage Retention -->
              <div class="bg-surface-container-low border-2 border-on-surface p-4 flex flex-col gap-3">
                <div class="flex items-center justify-between">
                  <span class="font-display text-xs font-bold uppercase flex items-center gap-2">
                    <span class="material-symbols-outlined text-base">auto_delete</span>
                    STORAGE RETENTION &amp; LIFECYCLE DISPOSITION
                  </span>
                  <span class="chip-bauhaus bg-surface-container-highest">CRON: HOURLY</span>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div class="flex flex-col gap-1">
                    <label class="font-display text-[10px] font-bold uppercase text-on-surface-variant">AUTOMATED EXPIRATION RULE</label>
                    <select class="input-bauhaus w-full font-bold">
                      <option>Purge sessions older than 14 days</option>
                      <option>Purge sessions older than 7 days</option>
                      <option>Purge sessions older than 24 hours</option>
                      <option>Retain infinitely until quota threshold (90%)</option>
                    </select>
                  </div>
                  <div class="flex flex-col gap-1">
                    <span class="font-display text-[10px] font-bold uppercase text-on-surface-variant">ENCODING &amp; CODECS</span>
                    <div class="grid grid-cols-2 gap-2">
                      <div class="p-2 bg-surface-container-lowest border border-on-surface flex items-center justify-between shadow-tectonic-xs">
                        <span class="font-display text-[10px] font-bold">LZ-STRING</span>
                        <span class="w-3.5 h-3.5 bg-secondary flex items-center justify-center text-white text-[10px]">✓</span>
                      </div>
                      <div class="p-2 bg-surface-container-lowest border border-on-surface flex items-center justify-between shadow-tectonic-xs">
                        <span class="font-display text-[10px] font-bold">BROTLI 6</span>
                        <span class="w-3.5 h-3.5 bg-secondary flex items-center justify-center text-white text-[10px]">✓</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Export Actions -->
              <div class="flex flex-col gap-2">
                <span class="font-display text-xs font-bold uppercase tracking-wider">CONSTRUCTIVIST EXPORT ACTIONS</span>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <button id="btn-export-all-json" class="btn-bauhaus btn-bauhaus-tertiary py-3 text-xs shadow-tectonic-sm">
                    <span class="material-symbols-outlined text-lg">code</span> [ EXPORT JSON BUNDLE ]
                  </button>
                  <button id="btn-export-all-har" class="btn-bauhaus btn-bauhaus-secondary py-3 text-xs shadow-tectonic-sm">
                    <span class="material-symbols-outlined text-lg">cloud_download</span> [ DOWNLOAD HAR ARCHIVE ]
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Bottom Override & Diagnostics Grid -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="bg-surface-container-high border-2 border-on-surface p-4 shadow-tectonic-sm flex flex-col justify-between">
              <div class="flex items-center justify-between">
                <span class="font-display text-xs font-bold uppercase">BUFFER PURGE OVERRIDE</span>
                <span class="w-3 h-3 bg-primary"></span>
              </div>
              <p class="font-body text-xs text-on-surface-variant mt-2">Wipe IndexedDB Tier 0 storage partition and reset telemetry queues.</p>
              <button id="btn-purge-tier0" class="btn-bauhaus btn-bauhaus-primary mt-4 self-start text-xs">
                PURGE TIER 0 DB
              </button>
            </div>
            <div class="bg-surface-container-high border-2 border-on-surface p-4 shadow-tectonic-sm flex flex-col justify-between">
              <div class="flex items-center justify-between">
                <span class="font-display text-xs font-bold uppercase">DIAGNOSTIC TELEMETRY PIPE</span>
                <span class="w-3 h-3 bg-tertiary-container"></span>
              </div>
              <p class="font-body text-xs text-on-surface-variant mt-2">Live IPC ping across Chrome Extension Service Worker and Pages dashboard.</p>
              <div class="mt-4 flex items-center justify-between">
                <span id="ipc-latency-badge" class="font-mono text-xs font-bold">LATENCY: 1.12ms</span>
                <button id="btn-ping-ipc" class="btn-bauhaus text-[10px] py-0.5 px-2">PING IPC</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ==========================================
// TAB 05: SPANS & MUTATIONS
// ==========================================
function renderSpansMutationsTab() {
  const events = state.activeEvents || [];

  return `
    <div class="p-6 flex flex-col gap-6">
      <div class="bg-surface-container-high border-2 border-on-surface p-4 flex items-center justify-between shadow-tectonic-sm">
        <div class="flex items-center gap-3">
          <span class="material-symbols-outlined text-primary text-2xl">conversion_path</span>
          <div>
            <h2 class="font-display text-lg font-bold uppercase tracking-tight">DOM MUTATION &amp; TELEMETRY LEDGER</h2>
            <p class="font-display text-xs text-on-surface-variant uppercase">Granular breakdown of DOM mutation types and serialization spans</p>
          </div>
        </div>
        <span class="chip-bauhaus bg-secondary text-white font-bold">${events.length} TOTAL EVENTS</span>
      </div>

      <div class="bg-surface-container-lowest border-2 border-on-surface p-6 shadow-tectonic">
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div class="p-3 bg-surface-container border border-on-surface">
            <span class="font-display text-[10px] uppercase font-bold text-on-surface-variant block">DOM FULL SNAPSHOTS</span>
            <span class="font-display text-lg font-bold mt-1 block">${events.filter(e => e.type === 2).length}</span>
          </div>
          <div class="p-3 bg-surface-container border border-on-surface">
            <span class="font-display text-[10px] uppercase font-bold text-on-surface-variant block">INCREMENTAL MUTATIONS</span>
            <span class="font-display text-lg font-bold mt-1 block">${events.filter(e => e.type === 3).length}</span>
          </div>
          <div class="p-3 bg-surface-container border border-on-surface">
            <span class="font-display text-[10px] uppercase font-bold text-on-surface-variant block">META VIEWPORT EVENTS</span>
            <span class="font-display text-lg font-bold mt-1 block">${events.filter(e => e.type === 4).length}</span>
          </div>
          <div class="p-3 bg-surface-container border border-on-surface">
            <span class="font-display text-[10px] uppercase font-bold text-on-surface-variant block">CUSTOM TELEMETRY</span>
            <span class="font-display text-lg font-bold mt-1 block">${events.filter(e => e.type === 5).length}</span>
          </div>
        </div>

        <table class="bauhaus-table font-mono text-xs">
          <thead>
            <tr>
              <th class="w-16">INDEX</th>
              <th class="w-24">TYPE ID</th>
              <th>CATEGORY</th>
              <th>DELTA TIME</th>
              <th>PAYLOAD SUMMARY</th>
            </tr>
          </thead>
          <tbody>
            ${events.slice(0, 30).map((ev, i) => `
              <tr>
                <td>#${i + 1}</td>
                <td><span class="status-badge status-200">TYPE ${ev.type}</span></td>
                <td class="font-bold">${ev.type === 2 ? 'FullSnapshot' : (ev.type === 3 ? 'IncrementalSnapshot' : (ev.type === 4 ? 'Meta' : 'Custom'))}</td>
                <td>+${events[0] ? (ev.timestamp - events[0].timestamp) : 0}ms</td>
                <td class="truncate max-w-xs text-on-surface-variant">${escapeHtml(JSON.stringify(ev.data || {}).slice(0, 80))}...</td>
              </tr>
            `).join('') || `<tr><td colspan="5" class="p-6 text-center text-on-surface-variant">NO EVENTS LOADED. SELECT A SESSION.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ==========================================
// EVENT HANDLERS & BINDINGS
// ==========================================
function attachEventHandlers() {
  // Sidebar & Top Nav clicks
  document.querySelectorAll('.nav-item, .top-tab').forEach(el => {
    el.addEventListener('click', () => {
      const tab = el.dataset.tab;
      if (tab) switchTab(tab);
    });
  });

  // Sessions Table Action Buttons
  document.querySelectorAll('.btn-play-session').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      loadSessionForReplay(id);
      switchTab('replayer');
    });
  });

  document.querySelectorAll('.btn-json-session').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      showToast('EXPORTING SESSION JSON...');
      await exportSessionJson([id]);
      showToast('SESSION JSON EXPORT COMPLETE');
    });
  });

  document.querySelectorAll('.btn-har-session').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      showToast('EXPORTING HAR 1.2 ARCHIVE...');
      await exportSessionHar([id]);
      showToast('HAR ARCHIVE EXPORT COMPLETE');
    });
  });

  document.querySelectorAll('.btn-del-session').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (confirm('Delete this recorded telemetry session?')) {
        await deleteSessions([id]);
        showToast('SESSION REMOVED FROM STORAGE');
        await refreshSessions();
        render();
      }
    });
  });

  // Sessions Filter Input
  const filterInput = document.getElementById('sessions-filter-input');
  if (filterInput) {
    filterInput.addEventListener('input', (e) => {
      state.harFilter = e.target.value;
      render();
    });
  }

  // Bulk Selection
  const selectAllCb = document.getElementById('select-all-sessions');
  if (selectAllCb) {
    selectAllCb.addEventListener('change', (e) => {
      if (e.target.checked) {
        state.sessions.forEach(s => state.selectedSessionIds.add(s.id));
      } else {
        state.selectedSessionIds.clear();
      }
      render();
    });
  }

  document.querySelectorAll('.session-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = cb.dataset.id;
      if (e.target.checked) state.selectedSessionIds.add(id);
      else state.selectedSessionIds.delete(id);
    });
  });

  // Bulk Delete
  const bulkDelBtn = document.getElementById('btn-bulk-delete');
  if (bulkDelBtn) {
    bulkDelBtn.addEventListener('click', async () => {
      if (state.selectedSessionIds.size === 0) {
        showToast('NO SESSIONS SELECTED FOR DELETION', true);
        return;
      }
      if (confirm(`Delete ${state.selectedSessionIds.size} selected session(s)?`)) {
        await deleteSessions(Array.from(state.selectedSessionIds));
        state.selectedSessionIds.clear();
        showToast('SELECTED SESSIONS REMOVED');
        await refreshSessions();
        render();
      }
    });
  }

  // Bulk Export
  const bulkExportBtn = document.getElementById('btn-bulk-export');
  if (bulkExportBtn) {
    bulkExportBtn.addEventListener('click', async () => {
      const ids = state.selectedSessionIds.size > 0 
        ? Array.from(state.selectedSessionIds) 
        : state.sessions.map(s => s.id);
      if (ids.length === 0) {
        showToast('NO SESSIONS TO EXPORT', true);
        return;
      }
      showToast(`EXPORTING ${ids.length} SESSIONS...`);
      await exportSessionJson(ids);
      showToast('EXPORT COMPLETE');
    });
  }

  // Dispatch Rec Button in Tab 01
  const dispatchRecBtn = document.getElementById('btn-create-recording');
  if (dispatchRecBtn) {
    dispatchRecBtn.addEventListener('click', () => {
      switchTab('engine');
    });
  }

  // Replayer Top Bar Actions
  const exportSessionHarBtn = document.getElementById('btn-export-session-har');
  if (exportSessionHarBtn) {
    exportSessionHarBtn.addEventListener('click', async () => {
      if (state.selectedSessionId) {
        showToast('SERIALIZING W3C HAR 1.2 ARCHIVE...');
        await exportSessionHar([state.selectedSessionId]);
        showToast('HAR DOWNLOAD COMPLETE');
      } else {
        showToast('NO ACTIVE SESSION LOADED', true);
      }
    });
  }

  // Replayer Playback Controls
  const playPauseBtn = document.getElementById('btn-play-pause');
  if (playPauseBtn) playPauseBtn.addEventListener('click', togglePlay);

  const stepBackBtn = document.getElementById('btn-step-back');
  if (stepBackBtn) stepBackBtn.addEventListener('click', () => stepTime(-100));

  const stepFwdBtn = document.getElementById('btn-step-forward');
  if (stepFwdBtn) stepFwdBtn.addEventListener('click', () => stepTime(100));

  const skipInactiveBtn = document.getElementById('btn-skip-inactive');
  if (skipInactiveBtn) {
    skipInactiveBtn.addEventListener('click', () => {
      if (state.playerInstance) {
        state.playerInstance.toggleSkipInactive();
        showToast('INACTIVITY SKIP TOGGLED');
      }
    });
  }

  // Speed Tiles
  document.querySelectorAll('.btn-speed-tile').forEach(btn => {
    btn.addEventListener('click', () => {
      const speed = parseFloat(btn.dataset.speed);
      setPlaybackSpeed(speed);
      showToast(`PLAYBACK SPEED: ${speed}×`);
    });
  });

  // Scrubber Track Click / Drag Seek
  const scrubberTrack = document.getElementById('scrubber-track');
  if (scrubberTrack) {
    scrubberTrack.addEventListener('click', (e) => {
      const rect = scrubberTrack.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(1, clickX / rect.width));
      seekToMs(pct * state.totalDurationMs);
    });
  }

  // HAR Table Row Click
  document.querySelectorAll('#har-table-body tr').forEach(row => {
    row.addEventListener('click', () => {
      const idx = parseInt(row.dataset.harIndex, 10);
      if (!isNaN(idx)) {
        selectHarEntry(idx);
        // Bi-directional sync: seek replayer to this request's start time!
        const entry = state.activeHarEntries[idx];
        if (entry && state.activeEvents[0]) {
          const reqTime = new Date(entry.startedDateTime).getTime();
          const relMs = reqTime - state.activeEvents[0].timestamp;
          if (relMs >= 0) {
            seekToMs(relMs);
          }
        }
      }
    });
  });

  // HAR Inspector Sub-tabs
  document.querySelectorAll('.btn-inspector-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedHarSubtab = btn.dataset.subtab;
      document.querySelectorAll('.btn-inspector-tab').forEach(b => {
        b.className = 'btn-inspector-tab px-1.5 py-0.5 bg-surface-container-highest text-on-surface';
      });
      btn.className = 'btn-inspector-tab px-1.5 py-0.5 bg-primary text-white';
      renderHarEntryInspector();
    });
  });

  // HAR Filter Input
  const harFilterInput = document.getElementById('har-filter-input');
  if (harFilterInput) {
    harFilterInput.addEventListener('input', (e) => {
      state.harFilter = e.target.value;
      render();
    });
  }

  // HAR Type Filter Buttons
  document.querySelectorAll('.btn-har-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      state.harTypeFilter = btn.dataset.type;
      render();
    });
  });

  // Tab 04 Engine Controls: Master Dispatch
  const hubRecBtn = document.getElementById('hub-recording-btn');
  if (hubRecBtn) {
    hubRecBtn.addEventListener('click', async () => {
      const isRec = state.recorderStatus.status === 'RECORDING';
      const eventName = isRec ? 'stop-recording-button-clicked' : 'start-recording-button-clicked';
      
      showToast(`DISPATCHING RECORDER: ${isRec ? 'HALT' : 'ARMED'}...`);
      try {
        await chrome.runtime.sendMessage(JSON.stringify({
          type: 'event',
          event: eventName,
          detail: {}
        }));
        setTimeout(async () => {
          await syncRecorderStatus();
          await refreshSessions();
          render();
        }, 500);
      } catch (e) {
        console.error('Failed to dispatch recording event:', e);
        showToast('COMMUNICATION FAILED WITH SERVICE WORKER', true);
      }
    });
  }

  // Tab 04 Export All Actions
  const expAllJson = document.getElementById('btn-export-all-json');
  if (expAllJson) {
    expAllJson.addEventListener('click', async () => {
      const ids = state.sessions.map(s => s.id);
      showToast('EXPORTING GZIP PAYLOAD (JSON BUNDLE)...');
      await exportSessionJson(ids);
      showToast('JSON BUNDLE DOWNLOADED');
    });
  }

  const expAllHar = document.getElementById('btn-export-all-har');
  if (expAllHar) {
    expAllHar.addEventListener('click', async () => {
      const ids = state.sessions.map(s => s.id);
      showToast('SERIALIZING RAW HAR STREAM ARCHIVE...');
      await exportSessionHar(ids);
      showToast('HAR ARCHIVE DOWNLOADED');
    });
  }

  // Tab 04 Buffer Purge
  const purgeBtn = document.getElementById('btn-purge-tier0');
  if (purgeBtn) {
    purgeBtn.addEventListener('click', async () => {
      if (confirm('Execute zero-fill wipe of IndexedDB Tier 0 session & event stores?')) {
        await purgeAllData();
        showToast('INDEXED-DB ALLOCATION CLEARED (0.00 MB ALLOCATED)');
        await refreshSessions();
        render();
      }
    });
  }

  // Tab 04 IPC Ping
  const pingBtn = document.getElementById('btn-ping-ipc');
  if (pingBtn) {
    pingBtn.addEventListener('click', async () => {
      const t0 = performance.now();
      try {
        await chrome.runtime.sendMessage(JSON.stringify({ type: 'service', service: 'ping' }));
      } catch (e) {}
      const lat = (performance.now() - t0).toFixed(2);
      const badge = document.getElementById('ipc-latency-badge');
      if (badge) badge.textContent = `LATENCY: ${lat}ms (OK)`;
      showToast(`IPC ROUND-TRIP: ${lat}ms`);
    });
  }

  // Keyboard Spacebar Shortcut for Play/Pause
  window.onkeydown = (e) => {
    if (e.code === 'Space' && e.target === document.body && state.activeTab === 'replayer') {
      e.preventDefault();
      togglePlay();
    }
  };
}

// --- Initialize App ---
(async function init() {
  window.addEventListener('hashchange', parseRoute);
  await refreshSessions();
  await syncRecorderStatus();

  // Listen to background updates
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.recorder_status) {
      state.recorderStatus = changes.recorder_status.newValue;
      updateSidebarFooter();
      updateTopBarStatus();
      if (state.activeTab === 'engine') {
        render();
      }
    }
  });

  parseRoute();
})();
