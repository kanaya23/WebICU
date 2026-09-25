// dashboard.js - Minimalist Bauhaus Studio Module with Adaptive Scaling, Causality & Progressive Snapshots
import * as db from '../db.js';
import { ZipWriter } from '../zip.js';

let activePlayerInstance = null;
let currentLoadedSessionId = null;
let cachedSessions = [];
let loadedEvents = [];
let currentFilterType = 'all';
let currentlySelectedEvent = null;

// Native resolution tracking
let currentNativeWidth = 1280;
let currentNativeHeight = 720;
let stageResizeObserver = null;
let stageResizeTimeout = null;

// Parsed Causality, Snapshot & Network structures
let parsedSnapshots = [];
let parsedActions = [];
let parsedNetwork = [];
let currentlySelectedNetworkReq = null;
let currentNetDetailView = 'response'; // 'response' | 'headers' | 'request'
let currentNetFilterType = 'all'; // 'all' | 'action' | 'error'

// Playback state
let currentReplayer = null;
let playbackAnimFrame = null;
let totalSessionDurationMs = 0;
let isCurrentlyPlaying = false;
let isScrubbing = false;
let currentSpeed = 1.0;
let isSkipInactive = true;
let isInspectorVisible = true;

// Top Nav elements
const navTabs = document.querySelectorAll('.nav-tab');
const viewPanels = {
  sessions: document.getElementById('sessionsListView'),
  player: document.getElementById('playerView'),
  storage: document.getElementById('storageView')
};
const navRecordingBadge = document.getElementById('navRecordingBadge');

// Sessions List elements
const sessionsContainer = document.getElementById('sessionsContainer');
const emptyState = document.getElementById('emptyState');
const sessionCountBadge = document.getElementById('sessionCountBadge');
const searchInput = document.getElementById('searchInput');
const importJsonInput = document.getElementById('importJsonInput');
const clearAllBtn = document.getElementById('clearAllBtn');

// Player View elements
const backToListBtn = document.getElementById('backToListBtn');
const playerSessionTitle = document.getElementById('playerSessionTitle');
const playerMetaBadges = document.getElementById('playerMetaBadges');
const playerUrlDisplay = document.getElementById('playerUrlDisplay');
const rrwebPlayerMount = document.getElementById('webicuPlayerMount') || document.getElementById('rrwebPlayerMount');

// Clean Bauhaus SVG Icons (Replacing unicode emojis across dashboard)
const SVG_ICONS = {
  clock: `<svg class="bauhaus-inline-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 4.5v3.5l2.5 1.5"/></svg>`,
  pulse: `<svg class="bauhaus-inline-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8.5h3l2-4 3 8 2-4h4"/></svg>`,
  zip: `<svg class="bauhaus-inline-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 5.5l5.5-3 5.5 3v6l-5.5 3-5.5-3v-6z"/><path d="M2.5 5.5l5.5 3 5.5-3"/><path d="M8 8.5v6"/></svg>`,
  close: `<svg class="bauhaus-inline-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>`,
  input: `<svg class="bauhaus-inline-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M6 6h4M6 9h4M6 12h2"/></svg>`,
  ui: `<svg class="bauhaus-inline-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 7h12M6 13V7"/></svg>`,
  network: `<svg class="bauhaus-inline-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2a9 9 0 0 1 0 12 9 9 0 0 1 0-12"/></svg>`,
  eye: `<svg class="bauhaus-inline-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8s2.5-4.5 6.5-4.5 6.5 4.5 6.5 4.5-2.5 4.5-6.5 4.5-6.5-4.5-6.5-4.5z"/><circle cx="8" cy="8" r="2"/></svg>`,
  download: `<svg class="bauhaus-inline-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8M4.5 7.5l3.5 3.5 3.5-3.5M2 13.5h12"/></svg>`,
  cdp: `<svg class="bauhaus-inline-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><path d="M8.5 8.5L13 13"/></svg>`,
  dim: `<svg class="bauhaus-inline-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 3l12 10"/></svg>`,
  spark: `<svg class="bauhaus-inline-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 1.5l-5 8h4.5l-1 5 5-8h-4.5l1-5z"/></svg>`
};
const stageViewportContainer = document.getElementById('stageViewportContainer');
const workbenchGrid = document.getElementById('workbenchGrid');
const toggleInspectorBtn = document.getElementById('toggleInspectorBtn');
const inspectorToggleText = document.getElementById('inspectorToggleText');
const btnExportZipArchive = document.getElementById('btnExportZipArchive');
const exportCurrentBtn = document.getElementById('exportCurrentBtn');
const deleteCurrentBtn = document.getElementById('deleteCurrentBtn');

// Bauhaus Mechanical Playback Bar elements
const playbackBarContainer = document.getElementById('playbackBarContainer');
const playbackTimeCurrent = document.getElementById('playbackTimeCurrent');
const playbackTimeTotal = document.getElementById('playbackTimeTotal');
const playbackScrubberTrack = document.getElementById('playbackScrubberTrack');
const playbackProgressBar = document.getElementById('playbackProgressBar');
const playbackMilestones = document.getElementById('playbackMilestones');
const playbackScrubberThumb = document.getElementById('playbackScrubberThumb');
const btnPlayPause = document.getElementById('btnPlayPause');
const iconPlay = document.getElementById('iconPlay');
const iconPause = document.getElementById('iconPause');
const btnStepBack = document.getElementById('btnStepBack');
const btnStepForward = document.getElementById('btnStepForward');
const btnToggleSkipInactive = document.getElementById('btnToggleSkipInactive');
const speedButtons = document.querySelectorAll('.speed-tile-group .speed-btn');
const playbackFrameBadge = document.getElementById('playbackFrameBadge');

// Inspector Multi-Tab elements
const inspectorTabs = document.querySelectorAll('.insp-tab');
const inspSubpanels = {
  actions: document.getElementById('panelInspActions'),
  snapshots: document.getElementById('panelInspSnapshots'),
  events: document.getElementById('panelInspEvents'),
  network: document.getElementById('panelInspNetwork')
};
const inspActionsCount = document.getElementById('inspActionsCount');
const inspSnapshotsCount = document.getElementById('inspSnapshotsCount');
const inspNetworkCount = document.getElementById('inspNetworkCount');
const actionsListContainer = document.getElementById('actionsListContainer');
const snapshotsListContainer = document.getElementById('snapshotsListContainer');

// Network Inspector elements (Tab 4)
const networkFilterInput = document.getElementById('networkFilterInput');
const networkFilterPills = document.querySelectorAll('#networkFilterPills .filter-pill');
const netFilterAllCount = document.getElementById('netFilterAllCount');
const networkTableBody = document.getElementById('networkTableBody');
const selectedNetworkHeader = document.getElementById('selectedNetworkHeader');
const networkDetailViewer = document.getElementById('networkDetailViewer');
const btnCopyNetworkJson = document.getElementById('btnCopyNetworkJson');
const netDetailTabs = document.querySelectorAll('.net-detail-tab');

// DevTools Inspector elements (Tab 3)
const eventInspectorCount = document.getElementById('eventInspectorCount');
const eventTableBody = document.getElementById('eventTableBody');
const eventFilterInput = document.getElementById('eventFilterInput');
const eventFilterPills = document.querySelectorAll('.filter-pill');
const selectedEventHeader = document.getElementById('selectedEventHeader');
const rawJsonViewer = document.getElementById('rawJsonViewer');
const btnCopyJsonPayload = document.getElementById('btnCopyJsonPayload');

// Snapshot Preview Modal elements
const snapshotPreviewModal = document.getElementById('snapshotPreviewModal');
const snapshotModalTitle = document.getElementById('snapshotModalTitle');
const snapshotModalIframe = document.getElementById('snapshotModalIframe');
const btnCloseSnapshotModal = document.getElementById('btnCloseSnapshotModal');
const btnOpenSnapshotNewTab = document.getElementById('btnOpenSnapshotNewTab');
const btnDownloadSnapshotModal = document.getElementById('btnDownloadSnapshotModal');

// Storage elements
const storageAllocationBadge = document.getElementById('storageAllocationBadge');
const storageDomText = document.getElementById('storageDomText');
const storageMutText = document.getElementById('storageMutText');
const storagePayloadText = document.getElementById('storagePayloadText');
const btnExportAllBundle = document.getElementById('btnExportAllBundle');
const btnClearStorageDb = document.getElementById('btnClearStorageDb');

const EVENT_TYPE_NAMES = {
  0: 'DomContentLoaded',
  1: 'Load',
  2: 'FullSnapshot',
  3: 'IncrementalSnapshot',
  4: 'Meta',
  5: 'Custom'
};

function formatDuration(ms) {
  if (!ms || ms < 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function formatDetailedTime(ms) {
  if (!ms || ms < 0) return '00:00.00';
  const totalSeconds = ms / 1000;
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  const hundredths = Math.floor((ms % 1000) / 10);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${hundredths.toString().padStart(2, '0')}`;
}

function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function calculateStageDimensions() {
  if (!stageViewportContainer) return { width: 1024, height: 576 };
  const rect = stageViewportContainer.getBoundingClientRect();
  const availW = Math.max(360, Math.floor(rect.width - 24));
  const availH = Math.max(240, Math.floor(rect.height - 24));

  const scaleW = availW / currentNativeWidth;
  const scaleH = availH / currentNativeHeight;
  const fitScale = Math.min(scaleW, scaleH);

  const targetW = Math.round(currentNativeWidth * fitScale);
  const targetH = Math.round(currentNativeHeight * fitScale);

  return {
    width: Math.max(360, targetW),
    height: Math.max(240, targetH)
  };
}

function updatePlayerDimensions() {
  if (!activePlayerInstance || !stageViewportContainer) return;
  const dims = calculateStageDimensions();
  try {
    activePlayerInstance.$set({
      width: dims.width,
      height: dims.height
    });
    if (typeof activePlayerInstance.triggerResize === 'function') {
      activePlayerInstance.triggerResize();
    }
  } catch (e) {
    console.warn('Could not update player size:', e);
  }
}

function getReplayerInstance(player) {
  if (!player) return null;
  if (typeof player.getReplayer === 'function') {
    const res = player.getReplayer();
    return (res && typeof res.play === 'function') ? res : (typeof res === 'function' ? res() : res);
  }
  return player.replayer || null;
}

function stopCurrentPlayback() {
  if (playbackAnimFrame) {
    cancelAnimationFrame(playbackAnimFrame);
    playbackAnimFrame = null;
  }
  if (currentReplayer && typeof currentReplayer.pause === 'function') {
    try { currentReplayer.pause(); } catch (e) {}
  }
  if (activePlayerInstance) {
    try {
      if (typeof activePlayerInstance.pause === 'function') activePlayerInstance.pause();
      if (typeof activePlayerInstance.$destroy === 'function') activePlayerInstance.$destroy();
    } catch (e) {}
    activePlayerInstance = null;
  }
  currentReplayer = null;
  isCurrentlyPlaying = false;
}

function switchView(viewKey) {
  try {
    window.scrollTo(0, 0);
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;

    navTabs.forEach(tab => {
      if (tab.dataset.view === viewKey) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    Object.keys(viewPanels).forEach(key => {
      if (viewPanels[key]) {
        if (key === viewKey) {
          viewPanels[key].classList.add('active');
        } else {
          viewPanels[key].classList.remove('active');
        }
      }
    });

    if (viewKey !== 'player') {
      stopCurrentPlayback();
      if (rrwebPlayerMount) rrwebPlayerMount.innerHTML = '';
    }

    if (viewKey === 'storage') {
      renderStorageStats();
    }
  } catch (viewErr) {
    console.warn('[WebICU Dashboard] switchView warning:', viewErr);
  }
}

navTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    switchView(tab.dataset.view);
  });
});

async function renderSessionsList() {
  const query = (searchInput?.value || '').trim().toLowerCase();
  try {
    cachedSessions = (await db.getAllSessions()) || [];
  } catch (err) {
    console.error('[WebICU Dashboard] Failed to get sessions from db:', err);
    cachedSessions = [];
  }

  const filtered = cachedSessions.filter((s) => {
    if (!query) return true;
    const nameMatch = (s.name || '').toLowerCase().includes(query);
    const urlMatch = (s.url || '').toLowerCase().includes(query);
    return nameMatch || urlMatch;
  });

  if (sessionCountBadge) {
    sessionCountBadge.textContent = `${cachedSessions.length} session${cachedSessions.length === 1 ? '' : 's'}`;
  }

  if (filtered.length === 0) {
    if (sessionsContainer) sessionsContainer.innerHTML = '';
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  if (sessionsContainer) sessionsContainer.innerHTML = '';

  filtered.forEach((session) => {
    const card = document.createElement('div');
    card.className = 'session-card';

    const shortId = session.id.replace('session_', '#').substring(0, 8);

    card.innerHTML = `
      <div class="card-header-bar">
        <span class="card-id">${shortId}</span>
        <span class="card-date">${formatDate(session.createTimestamp)}</span>
      </div>
      <div class="card-body">
        <input type="text" class="card-title-input" value="${escapeHtml(session.name || 'Untitled Session')}" title="Click to rename session">
        <div class="card-url" title="${escapeHtml(session.url || 'No URL')}">${escapeHtml(session.url || 'chrome-extension://local-session')}</div>
        <div class="card-stats">
          <span class="stat-chip">${SVG_ICONS.clock} ${formatDuration(session.durationMs)}</span>
          <span class="stat-chip">${SVG_ICONS.pulse} ${session.eventCount || 0} events</span>
        </div>
      </div>
      <div class="card-actions">
        <button class="btn btn-primary replay-btn">
          <span>Replay</span>
        </button>
        <button class="btn btn-secondary zip-btn" title="Export Structured ZIP (Snapshots, Actions, Causality)">
          <span>${SVG_ICONS.zip} ZIP</span>
        </button>
        <button class="btn btn-outline-danger delete-btn" title="Delete Session">
          <span>${SVG_ICONS.close}</span>
        </button>
      </div>
    `;

    // Title rename listener
    const titleInput = card.querySelector('.card-title-input');
    titleInput.addEventListener('change', async () => {
      const newTitle = titleInput.value.trim() || 'Untitled Session';
      session.name = newTitle;
      await db.updateSession(session);
    });

    // Replay button listener
    card.querySelector('.replay-btn').addEventListener('click', () => {
      openPlayer(session.id);
    });

    // ZIP export listener
    card.querySelector('.zip-btn').addEventListener('click', () => {
      exportSessionZip(session.id);
    });

    // Delete button listener
    card.querySelector('.delete-btn').addEventListener('click', async () => {
      if (confirm(`Delete session "${session.name}"?`)) {
        await db.deleteSession(session.id);
        await renderSessionsList();
      }
    });

    sessionsContainer.appendChild(card);
  });
}

function setPlayingStateUI(playing) {
  isCurrentlyPlaying = playing;
  if (!iconPlay || !iconPause || !btnPlayPause) return;
  if (playing) {
    iconPlay.style.display = 'none';
    iconPause.style.display = 'inline-block';
    btnPlayPause.title = 'Pause Replay [Space]';
  } else {
    iconPlay.style.display = 'inline-block';
    iconPause.style.display = 'none';
    btnPlayPause.title = 'Start Replay [Space]';
  }
}

function startPlaybackLoop() {
  if (playbackAnimFrame) {
    cancelAnimationFrame(playbackAnimFrame);
    playbackAnimFrame = null;
  }

  function tick() {
    if (currentReplayer && !isScrubbing) {
      let cur = 0;
      try {
        cur = typeof currentReplayer.getCurrentTime === 'function' ? currentReplayer.getCurrentTime() : 0;
      } catch (e) {}
      if (isNaN(cur) || cur < 0) cur = 0;

      const pct = Math.min(100, Math.max(0, (cur / (totalSessionDurationMs || 1)) * 100));
      if (playbackProgressBar) playbackProgressBar.style.width = pct + '%';
      if (playbackScrubberThumb) playbackScrubberThumb.style.left = pct + '%';
      if (playbackTimeCurrent) playbackTimeCurrent.textContent = formatDetailedTime(cur);
      if (playbackFrameBadge) playbackFrameBadge.textContent = '#' + Math.floor(cur / 16.66).toString().padStart(5, '0');

      if (cur >= totalSessionDurationMs - 40 && totalSessionDurationMs > 0) {
        setPlayingStateUI(false);
        stopPlaybackLoop();
        return;
      }
    }

    if (isCurrentlyPlaying) {
      playbackAnimFrame = requestAnimationFrame(tick);
    }
  }

  playbackAnimFrame = requestAnimationFrame(tick);
}

function stopPlaybackLoop() {
  if (playbackAnimFrame) {
    cancelAnimationFrame(playbackAnimFrame);
    playbackAnimFrame = null;
  }
}

function initPlaybackBar(replayer, events) {
  currentReplayer = replayer;
  if (!currentReplayer) return;

  const meta = typeof currentReplayer.getMetaData === 'function' ? currentReplayer.getMetaData() : null;
  totalSessionDurationMs = (meta && meta.totalTime) || (events.length > 1 ? events[events.length - 1].timestamp - events[0].timestamp : 0);
  if (!totalSessionDurationMs || totalSessionDurationMs <= 0) totalSessionDurationMs = 1000;

  if (playbackTimeTotal) playbackTimeTotal.textContent = formatDetailedTime(totalSessionDurationMs);
  if (playbackTimeCurrent) playbackTimeCurrent.textContent = formatDetailedTime(0);
  if (playbackProgressBar) playbackProgressBar.style.width = '0%';
  if (playbackScrubberThumb) playbackScrubberThumb.style.left = '0%';
  if (playbackFrameBadge) playbackFrameBadge.textContent = '#00,001';

  // Render milestones on scrubber track: Snapshots (blue), Actions (red), Effects (gold)
  if (playbackMilestones) {
    playbackMilestones.innerHTML = '';
    const firstTs = events.length > 0 ? events[0].timestamp : 0;

    // 1. Snapshot markers
    parsedSnapshots.forEach(snap => {
      const offset = snap.timestamp - firstTs;
      const pct = Math.min(100, Math.max(0, (offset / totalSessionDurationMs) * 100));
      const marker = document.createElement('div');
      marker.className = 'milestone-marker marker-snapshot';
      marker.style.left = `${pct}%`;
      marker.title = `Snapshot #${snap.snapshotIndex} (${snap.triggerReason})`;
      playbackMilestones.appendChild(marker);
    });

    // 2. Action markers
    parsedActions.forEach(act => {
      const offset = act.timestamp - firstTs;
      const pct = Math.min(100, Math.max(0, (offset / totalSessionDurationMs) * 100));
      const marker = document.createElement('div');
      marker.className = `milestone-marker ${act.associated_effects?.length ? 'marker-effect' : 'marker-action'}`;
      marker.style.left = `${pct}%`;
      marker.title = `Action: ${act.actionType} on <${act.target?.tag || 'el'}>`;
      playbackMilestones.appendChild(marker);
    });

    // 3. Network request markers (Cyan/Blue)
    parsedNetwork.forEach(req => {
      const offset = (req.startTime || req.timestamp) - firstTs;
      const pct = Math.min(100, Math.max(0, (offset / totalSessionDurationMs) * 100));
      const marker = document.createElement('div');
      marker.className = 'milestone-marker marker-network';
      marker.style.left = `${pct}%`;
      marker.title = `HTTP ${req.method} (${req.status || 'OK'}): ${req.url}`;
      playbackMilestones.appendChild(marker);
    });
  }

  setPlayingStateUI(true);
  startPlaybackLoop();

  if (typeof currentReplayer.setConfig === 'function') {
    currentReplayer.setConfig({
      speed: currentSpeed,
      skipInactive: isSkipInactive
    });
  }

  if (typeof currentReplayer.on === 'function') {
    currentReplayer.on('state-change', (data) => {
      if (data && data.player && data.player.value) {
        const isPlay = data.player.value === 'playing';
        setPlayingStateUI(isPlay);
        if (isPlay) {
          startPlaybackLoop();
        } else {
          stopPlaybackLoop();
        }
      }
    });

    currentReplayer.on('start', () => {
      setPlayingStateUI(true);
      startPlaybackLoop();
    });

    currentReplayer.on('resume', () => {
      setPlayingStateUI(true);
      startPlaybackLoop();
    });

    currentReplayer.on('pause', () => {
      setPlayingStateUI(false);
      stopPlaybackLoop();
    });

    currentReplayer.on('finish', () => {
      setPlayingStateUI(false);
      stopPlaybackLoop();
      if (playbackProgressBar) playbackProgressBar.style.width = '100%';
      if (playbackScrubberThumb) playbackScrubberThumb.style.left = '100%';
      if (playbackTimeCurrent) playbackTimeCurrent.textContent = formatDetailedTime(totalSessionDurationMs);
    });
  }
}

function seekTo(targetTimeMs, shouldPlayAfter) {
  if (!currentReplayer) return;
  const bounded = Math.max(0, Math.min(totalSessionDurationMs, targetTimeMs));
  
  if (shouldPlayAfter) {
    currentReplayer.play(bounded);
    setPlayingStateUI(true);
    startPlaybackLoop();
  } else {
    currentReplayer.pause(bounded);
    setPlayingStateUI(false);
    stopPlaybackLoop();
  }

  const pct = Math.min(100, Math.max(0, (bounded / (totalSessionDurationMs || 1)) * 100));
  if (playbackProgressBar) playbackProgressBar.style.width = pct + '%';
  if (playbackScrubberThumb) playbackScrubberThumb.style.left = pct + '%';
  if (playbackTimeCurrent) playbackTimeCurrent.textContent = formatDetailedTime(bounded);
  if (playbackFrameBadge) playbackFrameBadge.textContent = '#' + Math.floor(bounded / 16.66).toString().padStart(5, '0');
}

function setupPlaybackListeners() {
  if (!btnPlayPause) return;

  btnPlayPause.addEventListener('click', () => {
    if (!currentReplayer) return;

    let isPlayingNow = isCurrentlyPlaying;
    if (currentReplayer.service && currentReplayer.service.state) {
      if (typeof currentReplayer.service.state.matches === 'function') {
        isPlayingNow = currentReplayer.service.state.matches('playing');
      } else if (currentReplayer.service.state.value) {
        isPlayingNow = currentReplayer.service.state.value === 'playing';
      }
    }

    if (isPlayingNow) {
      currentReplayer.pause();
      setPlayingStateUI(false);
      stopPlaybackLoop();
    } else {
      let cur = 0;
      try {
        cur = typeof currentReplayer.getCurrentTime === 'function' ? currentReplayer.getCurrentTime() : 0;
      } catch (e) {}
      if (isNaN(cur) || cur < 0) cur = 0;

      if (cur >= totalSessionDurationMs - 100) {
        currentReplayer.play(0);
      } else {
        currentReplayer.play(cur);
      }
      setPlayingStateUI(true);
      startPlaybackLoop();
    }
  });

  if (btnStepBack) {
    btnStepBack.addEventListener('click', () => {
      if (!currentReplayer) return;
      const cur = typeof currentReplayer.getCurrentTime === 'function' ? currentReplayer.getCurrentTime() : 0;
      seekTo(cur - 500, isCurrentlyPlaying);
    });
  }

  if (btnStepForward) {
    btnStepForward.addEventListener('click', () => {
      if (!currentReplayer) return;
      const cur = typeof currentReplayer.getCurrentTime === 'function' ? currentReplayer.getCurrentTime() : 0;
      seekTo(cur + 500, isCurrentlyPlaying);
    });
  }

  if (btnToggleSkipInactive) {
    btnToggleSkipInactive.addEventListener('click', () => {
      isSkipInactive = !isSkipInactive;
      if (currentReplayer && typeof currentReplayer.setConfig === 'function') {
        currentReplayer.setConfig({ skipInactive: isSkipInactive });
      }
      btnToggleSkipInactive.classList.toggle('active', isSkipInactive);
    });
  }

  speedButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      speedButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSpeed = parseFloat(btn.dataset.speed) || 1.0;
      if (currentReplayer && typeof currentReplayer.setConfig === 'function') {
        currentReplayer.setConfig({ speed: currentSpeed });
      }
    });
  });

  function handleTrackEvent(e) {
    if (!playbackScrubberTrack) return;
    const rect = playbackScrubberTrack.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekTo(ratio * totalSessionDurationMs, isCurrentlyPlaying);
  }

  if (playbackScrubberTrack) {
    playbackScrubberTrack.addEventListener('mousedown', (e) => {
      isScrubbing = true;
      const wasPlaying = isCurrentlyPlaying;
      handleTrackEvent(e);

      function onMouseMove(moveEvent) {
        if (isScrubbing) {
          handleTrackEvent(moveEvent);
        }
      }

      function onMouseUp(upEvent) {
        if (isScrubbing) {
          isScrubbing = false;
          handleTrackEvent(upEvent);
          if (wasPlaying) {
            const cur = typeof currentReplayer.getCurrentTime === 'function' ? currentReplayer.getCurrentTime() : 0;
            currentReplayer.play(cur);
            setPlayingStateUI(true);
            startPlaybackLoop();
          }
        }
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      }

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  // Toggle Inspector button
  if (toggleInspectorBtn && workbenchGrid) {
    toggleInspectorBtn.addEventListener('click', () => {
      isInspectorVisible = !isInspectorVisible;
      workbenchGrid.classList.toggle('inspector-hidden', !isInspectorVisible);
      if (inspectorToggleText) {
        inspectorToggleText.textContent = isInspectorVisible ? 'Hide Inspector' : 'Show Inspector';
      }
      setTimeout(updatePlayerDimensions, 180);
    });
  }

  // Copy JSON Payload button
  if (btnCopyJsonPayload) {
    btnCopyJsonPayload.addEventListener('click', () => {
      if (!currentlySelectedEvent) return;
      navigator.clipboard.writeText(JSON.stringify(currentlySelectedEvent, null, 2)).then(() => {
        btnCopyJsonPayload.textContent = 'Copied!';
        setTimeout(() => { btnCopyJsonPayload.textContent = 'Copy'; }, 1500);
      });
    });
  }

  // Spacebar toggle shortcut in player view
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && viewPanels.player && viewPanels.player.classList.contains('active')) {
      if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
        return;
      }
      e.preventDefault();
      if (btnPlayPause) btnPlayPause.click();
    }
  });

  // Window resize listener
  window.addEventListener('resize', () => {
    clearTimeout(stageResizeTimeout);
    stageResizeTimeout = setTimeout(updatePlayerDimensions, 60);
  });
}

// --- Inspector Tab Switching ---
inspectorTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    inspectorTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    const targetTab = tab.dataset.inspTab;
    Object.keys(inspSubpanels).forEach(key => {
      if (inspSubpanels[key]) {
        inspSubpanels[key].classList.toggle('active', key === targetTab);
      }
    });
  });
});

// --- Parse Snapshots & Actions from Events Stream ---
function parseSessionStructures(events, session) {
  parsedSnapshots = [];
  parsedActions = [];

  const initialTs = events.length > 0 ? events[0].timestamp : (session.createTimestamp || 0);

  // 1. Look for custom 'rolling-snapshot' events
  events.forEach((ev) => {
    if (ev.type === 5 && ev.data?.tag === 'rolling-snapshot') {
      const p = ev.data.payload || {};
      parsedSnapshots.push({
        snapshotIndex: p.snapshotIndex || (parsedSnapshots.length + 1),
        triggerReason: p.triggerReason || 'UNKNOWN',
        url: p.url || session.url,
        title: p.title || session.name,
        html: p.html || '',
        timestamp: ev.timestamp,
        relativeTimeMs: Math.max(0, ev.timestamp - initialTs)
      });
    }
  });

  // Fallback: If no custom snapshot was recorded, synthesize Snapshot #1 from FullSnapshot (type 2)
  if (parsedSnapshots.length === 0) {
    const fullSnapEv = events.find(e => e.type === 2);
    parsedSnapshots.push({
      snapshotIndex: 1,
      triggerReason: 'INITIAL_LOAD',
      url: session.url || 'chrome-extension://local-session',
      title: session.name || 'Initial Baseline',
      html: `<!DOCTYPE html>\n<html><head><title>${escapeHtml(session.name || 'Baseline')}</title></head><body><div id="rrweb-baseline-note"><!-- Serialized DOM baseline from rrweb FullSnapshot --></div><p>Session started on: ${escapeHtml(session.url || 'localhost')}</p></body></html>`,
      timestamp: fullSnapEv ? fullSnapEv.timestamp : initialTs,
      relativeTimeMs: 0
    });
  }

  // 2. Look for custom 'rolling-action' events
  events.forEach((ev) => {
    if (ev.type === 5 && ev.data?.tag === 'rolling-action') {
      const p = ev.data.payload || {};
      parsedActions.push({
        actionId: p.actionId || ('act_' + ev.timestamp),
        actionType: p.actionType || 'click',
        target: p.target || {},
        submitted_inputs: p.submitted_inputs || [],
        associated_effects: p.associated_effects || [],
        disassociated_background_events: p.disassociated_background_events || [],
        timestamp: ev.timestamp,
        relativeTimeMs: Math.max(0, ev.timestamp - initialTs)
      });
    }
  });

  // Fallback: If no custom rolling-action was recorded, synthesize actions from mouse interactions
  if (parsedActions.length === 0) {
    let actIndex = 1;
    events.forEach((ev, idx) => {
      // rrweb type 3 (IncrementalSnapshot), source 2 (MouseInteraction), data.type 2 (Click)
      if (ev.type === 3 && ev.data?.source === 2 && ev.data?.type === 2) {
        // Collect mutations in the subsequent 600ms
        const subsequentMutations = [];
        for (let j = idx + 1; j < Math.min(events.length, idx + 15); j++) {
          const nextEv = events[j];
          if (nextEv.timestamp - ev.timestamp > 650) break;
          if (nextEv.type === 3 && nextEv.data?.source === 0) { // DOM mutation
            subsequentMutations.push(nextEv);
          }
        }

        const effects = [];
        if (subsequentMutations.length > 0) {
          effects.push({
            type: 'dom_mutation_batch',
            role: 'interactive_ui',
            selector: '.dynamically-updated-element',
            summary: `${subsequentMutations.length} DOM mutations triggered by user click`,
            confidence: 0.85
          });
        }

        parsedActions.push({
          actionId: 'act_' + actIndex++,
          actionType: 'click',
          target: {
            tag: 'element',
            text: `Click at (${ev.data.x}, ${ev.data.y})`,
            cssSelector: `x:${ev.data.x}, y:${ev.data.y}`,
            coords: { x: ev.data.x, y: ev.data.y }
          },
          submitted_inputs: [],
          associated_effects: effects,
          associated_network_requests: [],
          disassociated_background_events: [],
          timestamp: ev.timestamp,
          relativeTimeMs: Math.max(0, ev.timestamp - initialTs)
        });
      }
    });
  }

  // 3. Look for custom 'rolling-network' events
  parsedNetwork = [];
  events.forEach((ev) => {
    if (ev.type === 5 && ev.data?.tag === 'rolling-network') {
      const p = ev.data.payload || {};
      parsedNetwork.push({
        requestId: p.requestId || ('req_' + ev.timestamp),
        associatedActionId: p.associatedActionId || null,
        initiator: p.initiator || 'fetch',
        method: (p.method || 'GET').toUpperCase(),
        url: p.url || '',
        startTime: p.startTime || ev.timestamp,
        endTime: p.endTime || ev.timestamp,
        durationMs: p.durationMs !== undefined ? p.durationMs : 0,
        status: p.status !== undefined ? p.status : 200,
        statusText: p.statusText || '',
        requestHeaders: p.requestHeaders || {},
        requestBody: p.requestBody || null,
        responseHeaders: p.responseHeaders || {},
        responseBody: p.responseBody || null,
        error: p.error || null,
        timestamp: ev.timestamp,
        relativeTimeMs: Math.max(0, (p.startTime || ev.timestamp) - initialTs)
      });
    }
  });

  // Cross-link network requests to actions
  parsedActions.forEach(act => {
    const linked = parsedNetwork.filter(r => r.associatedActionId === act.actionId);
    if (linked.length > 0) {
      act.associated_network_requests = linked;
    }
  });

  // Update tab counts
  if (inspActionsCount) inspActionsCount.textContent = `${parsedActions.length}`;
  if (inspSnapshotsCount) inspSnapshotsCount.textContent = `${parsedSnapshots.length}`;
  if (inspNetworkCount) inspNetworkCount.textContent = `${parsedNetwork.length}`;
  if (netFilterAllCount) netFilterAllCount.textContent = `${parsedNetwork.length}`;
}

// --- Render Tab 1: Actions & Causality ---
function renderActionsCausality() {
  if (!actionsListContainer) return;
  actionsListContainer.innerHTML = '';

  if (parsedActions.length === 0) {
    actionsListContainer.innerHTML = `
      <div style="padding: 30px 10px; text-align: center; color: var(--color-text-muted); font-size: 11px;">
        No user click or submit actions detected in this session.
      </div>
    `;
    return;
  }

  parsedActions.forEach((act, index) => {
    const card = document.createElement('div');
    card.className = 'action-card';

    const timeStr = `+${formatDetailedTime(act.relativeTimeMs)}`;
    const targetTag = act.target?.tag || 'element';
    const targetText = act.target?.text ? `"${act.target.text}"` : '';
    const selector = act.target?.cssSelector || act.target?.xpath || 'target';

    let inputsHtml = '';
    if (act.submitted_inputs && act.submitted_inputs.length > 0) {
      const inputsList = act.submitted_inputs.map(inp => {
        const fieldName = inp.name || inp.id || inp.placeholder || inp.type || 'field';
        return `<div class="action-input-row"><span class="action-input-tag">&lt;${escapeHtml(inp.tag)}&gt;</span> <strong class="action-input-field">${escapeHtml(fieldName)}:</strong> <span class="action-input-val">${escapeHtml(inp.value)}</span></div>`;
      }).join('');
      inputsHtml = `
        <div class="action-input-box">
          <div class="action-input-label">
            <span>${SVG_ICONS.input} Captured Input / Form State</span>
          </div>
          <div class="action-input-content">
            ${inputsList}
          </div>
        </div>
      `;
    }

    let effectsHtml = '';
    if (act.associated_effects && act.associated_effects.length > 0) {
      const eff = act.associated_effects[0];
      effectsHtml = `
        <div class="action-effect-box">
          <div class="action-effect-label">
            <span>${SVG_ICONS.ui} Spawned UI (${Math.round((eff.confidence || 0.9) * 100)}% Match)</span>
          </div>
          <div class="action-effect-summary">
            ${escapeHtml(eff.summary || eff.selector || 'DOM nodes added')}
          </div>
        </div>
      `;
    }

    let networkHtml = '';
    if (act.associated_network_requests && act.associated_network_requests.length > 0) {
      const netCount = act.associated_network_requests.length;
      const firstReq = act.associated_network_requests[0];
      let endpointName = 'api';
      try {
        const u = new URL(firstReq.url, 'http://localhost');
        endpointName = u.pathname.split('/').filter(Boolean).pop() || u.pathname;
      } catch (_) {
        endpointName = firstReq.url.substring(0, 30);
      }
      const label = netCount === 1
        ? `${firstReq.method} /${escapeHtml(endpointName)} (${firstReq.status || 'OK'} · ${firstReq.durationMs}ms)`
        : `${netCount} API Calls (${firstReq.method} /${escapeHtml(endpointName)} + ${netCount - 1} more)`;

      networkHtml = `
        <div class="action-network-box" data-action-id="${escapeHtml(act.actionId)}">
          <div class="action-network-label">
            <span>${SVG_ICONS.network} Triggered Network</span>
          </div>
          <div class="action-network-list">
            ${label}
          </div>
        </div>
      `;
    }

    let noiseHtml = '';
    if (act.disassociated_background_events && act.disassociated_background_events.length > 0) {
      noiseHtml = `
        <div class="action-noise-box">
          ℹ️ ${act.disassociated_background_events.length} background mutation${act.disassociated_background_events.length > 1 ? 's' : ''} disassociated (noise filtered)
        </div>
      `;
    }

    card.innerHTML = `
      <div class="action-card-header">
        <span class="action-type-badge ${act.actionType === 'submit' ? 'badge-submit' : 'badge-click'}">
          #${index + 1} ${act.actionType.toUpperCase()}
        </span>
        <span class="action-time-offset">${timeStr}</span>
      </div>
      <div class="action-target-info">
        &lt;${escapeHtml(targetTag)}&gt; ${escapeHtml(selector)}
      </div>
      ${targetText ? `<div class="action-target-text">${escapeHtml(targetText)}</div>` : ''}
      ${inputsHtml}
      ${effectsHtml}
      ${networkHtml}
      ${noiseHtml}
    `;

    // Click handler on network box jumps to Network tab
    const netBox = card.querySelector('.action-network-box');
    if (netBox) {
      netBox.addEventListener('click', (e) => {
        e.stopPropagation();
        const tabBtn = document.getElementById('tabInspNetwork');
        if (tabBtn) tabBtn.click();
        if (networkFilterInput) {
          networkFilterInput.value = act.actionId;
          renderNetworkWaterfall();
        }
      });
    }

    // Jump replayer to action timestamp on click
    card.addEventListener('click', () => {
      document.querySelectorAll('.action-card').forEach(c => c.classList.remove('active-step'));
      card.classList.add('active-step');
      seekTo(act.relativeTimeMs, isCurrentlyPlaying);
    });

    actionsListContainer.appendChild(card);
  });
}

// --- Render Tab 2: Progressive Snapshots ---
function renderProgressiveSnapshots() {
  if (!snapshotsListContainer) return;
  snapshotsListContainer.innerHTML = '';

  if (parsedSnapshots.length === 0) {
    snapshotsListContainer.innerHTML = `
      <div style="padding: 30px 10px; text-align: center; color: var(--color-text-muted); font-size: 11px;">
        No progressive snapshots captured.
      </div>
    `;
    return;
  }

  parsedSnapshots.forEach((snap) => {
    const item = document.createElement('div');
    item.className = 'snapshot-item';

    const timeStr = `+${formatDetailedTime(snap.relativeTimeMs)}`;

    item.innerHTML = `
      <div class="snapshot-item-header">
        <span class="snapshot-item-title">Snapshot #${snap.snapshotIndex}</span>
        <span class="snapshot-trigger-pill">${escapeHtml(snap.triggerReason)}</span>
      </div>
      <div class="snapshot-item-url" title="${escapeHtml(snap.url)}">${escapeHtml(snap.url)}</div>
      <div style="font-family: var(--font-mono); font-size: 10px; color: var(--color-text-muted);">
        Captured at ${timeStr}
      </div>
      <div class="snapshot-item-actions">
        <button class="btn btn-secondary preview-snap-btn" style="flex: 1; padding: 4px 8px;">
          <span>${SVG_ICONS.eye} Preview</span>
        </button>
        <button class="btn btn-secondary download-snap-btn" style="padding: 4px 8px;" title="Download standalone HTML">
          <span>${SVG_ICONS.download} HTML</span>
        </button>
      </div>
    `;

    // Preview in modal
    item.querySelector('.preview-snap-btn').addEventListener('click', () => {
      openSnapshotModal(snap);
    });

    // Direct HTML download
    item.querySelector('.download-snap-btn').addEventListener('click', async () => {
      const inlinedHtml = await inlineSnapshotExternalStyles(snap.html, snap.url);
      const blob = new Blob([inlinedHtml], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `snapshot_${String(snap.snapshotIndex).padStart(3, '0')}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    snapshotsListContainer.appendChild(item);
  });
}

// --- Render Tab 4: Network Waterfall & Lossless Payload Inspector ---
function renderNetworkWaterfall() {
  if (!networkTableBody) return;
  networkTableBody.innerHTML = '';

  const query = (networkFilterInput ? networkFilterInput.value : '').trim().toLowerCase();

  let filtered = parsedNetwork.filter(req => {
    if (currentNetFilterType === 'action' && !req.associatedActionId) return false;
    if (currentNetFilterType === 'error' && !req.error && req.status >= 200 && req.status < 400) return false;
    if (!query) return true;

    const urlMatch = req.url.toLowerCase().includes(query);
    const methodMatch = req.method.toLowerCase().includes(query);
    const statusMatch = String(req.status).includes(query);
    const idMatch = req.requestId.toLowerCase().includes(query);
    const actMatch = req.associatedActionId ? req.associatedActionId.toLowerCase().includes(query) : false;
    return urlMatch || methodMatch || statusMatch || idMatch || actMatch;
  });

  if (filtered.length === 0) {
    networkTableBody.innerHTML = `
      <tr>
        <td colspan="6" style="padding: 30px 10px; text-align: center; color: var(--color-text-muted); font-size: 11px;">
          ${parsedNetwork.length === 0 ? 'No HTTP fetch or XHR requests captured in this session.' : 'No network requests match your filter query.'}
        </td>
      </tr>
    `;
    if (selectedNetworkHeader) selectedNetworkHeader.textContent = 'No request selected';
    if (networkDetailViewer) networkDetailViewer.textContent = '// No matching request';
    return;
  }

  filtered.forEach((req, idx) => {
    const row = document.createElement('tr');
    row.className = 'event-row net-row';
    if (currentlySelectedNetworkReq && currentlySelectedNetworkReq.requestId === req.requestId) {
      row.classList.add('selected');
    }

    const relTime = formatDetailedTime(req.relativeTimeMs || 0);
    const duration = `${req.durationMs}ms`;

    // Status pill styling
    let statusClass = 'net-status-2xx';
    if (req.status === 0 || req.error) statusClass = 'net-status-err';
    else if (req.status >= 500) statusClass = 'net-status-5xx';
    else if (req.status >= 400) statusClass = 'net-status-4xx';
    else if (req.status >= 300) statusClass = 'net-status-3xx';

    // Method badge styling
    let methodClass = 'net-method-other';
    const m = req.method.toLowerCase();
    if (m === 'get') methodClass = 'net-method-get';
    else if (m === 'post') methodClass = 'net-method-post';
    else if (m === 'put') methodClass = 'net-method-put';
    else if (m === 'delete') methodClass = 'net-method-delete';

    let endpointDisplay = req.url;
    try {
      const u = new URL(req.url);
      endpointDisplay = u.pathname + (u.search ? u.search.substring(0, 35) : '');
    } catch (_) {}

    let actionBadgeHtml = '';
    if (req.associatedActionId) {
      const actIdx = parsedActions.findIndex(a => a.actionId === req.associatedActionId);
      const actNum = actIdx >= 0 ? `#${actIdx + 1}` : 'Act';
      actionBadgeHtml = `<span class="net-action-badge" title="Triggered by User Action ${actNum}">${SVG_ICONS.spark} ${actNum}</span>`;
    }

    row.innerHTML = `
      <td>#${idx + 1}</td>
      <td><span class="net-status-pill ${statusClass}">${req.status || (req.error ? 'ERR' : '---')}</span></td>
      <td><span class="net-method-badge ${methodClass}">${req.method}</span></td>
      <td style="font-size: 10px;">+${relTime}</td>
      <td style="font-size: 10px; color: var(--color-text-muted);">${duration}</td>
      <td class="event-summary-cell" title="${escapeHtml(req.url)}">${escapeHtml(endpointDisplay)}${actionBadgeHtml}</td>
    `;

    row.addEventListener('click', () => {
      document.querySelectorAll('.net-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      inspectNetworkDetails(req, idx + 1);
      seekTo(req.relativeTimeMs || 0, isCurrentlyPlaying);
    });

    networkTableBody.appendChild(row);
  });

  // Pre-select first item
  if (!currentlySelectedNetworkReq || !filtered.includes(currentlySelectedNetworkReq)) {
    document.querySelectorAll('.net-row')[0]?.classList.add('selected');
    inspectNetworkDetails(filtered[0], 1);
  }
}

function inspectNetworkDetails(req, index) {
  if (!req) return;
  currentlySelectedNetworkReq = req;

  if (selectedNetworkHeader) {
    const actStr = req.associatedActionId ? ` [Action ${req.associatedActionId}]` : '';
    selectedNetworkHeader.textContent = `#${index || 1} ${req.method} ${req.status || ''} ${actStr}`;
    selectedNetworkHeader.title = req.url;
  }

  updateNetworkDetailContentView();
}

function updateNetworkDetailContentView() {
  if (!networkDetailViewer || !currentlySelectedNetworkReq) return;
  const req = currentlySelectedNetworkReq;

  if (currentNetDetailView === 'response') {
    if (req.responseBody !== undefined && req.responseBody !== null) {
      if (typeof req.responseBody === 'object') {
        networkDetailViewer.textContent = JSON.stringify(req.responseBody, null, 2);
      } else {
        networkDetailViewer.textContent = String(req.responseBody);
      }
    } else if (req.error) {
      networkDetailViewer.textContent = `Network Error:\n${req.error}`;
    } else {
      networkDetailViewer.textContent = '// No response body received';
    }
  } else if (currentNetDetailView === 'headers') {
    const summary = {
      General: {
        Request_URL: req.url,
        Request_Method: req.method,
        Status_Code: `${req.status} ${req.statusText || ''}`,
        Duration: `${req.durationMs}ms`,
        Initiator: req.initiator || 'fetch',
        Associated_Action: req.associatedActionId || 'None (Autonomous/Background)'
      },
      Response_Headers: req.responseHeaders || {},
      Request_Headers: req.requestHeaders || {}
    };
    networkDetailViewer.textContent = JSON.stringify(summary, null, 2);
  } else if (currentNetDetailView === 'request') {
    if (req.requestBody !== undefined && req.requestBody !== null) {
      if (typeof req.requestBody === 'object') {
        networkDetailViewer.textContent = JSON.stringify(req.requestBody, null, 2);
      } else {
        networkDetailViewer.textContent = String(req.requestBody);
      }
    } else {
      networkDetailViewer.textContent = '// No request body payload (GET / HEAD or empty body)';
    }
  }
}

// Network UI Event Listeners
if (networkFilterInput) {
  networkFilterInput.addEventListener('input', () => {
    renderNetworkWaterfall();
  });
}

networkFilterPills.forEach(pill => {
  pill.addEventListener('click', () => {
    networkFilterPills.forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    currentNetFilterType = pill.dataset.netFilter || 'all';
    renderNetworkWaterfall();
  });
});

netDetailTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    netDetailTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentNetDetailView = tab.dataset.detailView || 'response';
    updateNetworkDetailContentView();
  });
});

if (btnCopyNetworkJson) {
  btnCopyNetworkJson.addEventListener('click', () => {
    if (!currentlySelectedNetworkReq) return;
    const fullJson = JSON.stringify(currentlySelectedNetworkReq, null, 2);
    navigator.clipboard.writeText(fullJson).then(() => {
      const orig = btnCopyNetworkJson.textContent;
      btnCopyNetworkJson.textContent = 'Copied!';
      setTimeout(() => { btnCopyNetworkJson.textContent = orig; }, 1200);
    });
  });
}

// Cache for inlined external stylesheets to prevent duplicate network fetches
const stylesheetCache = new Map();

function rebaseCssUrls(cssText, stylesheetUrl) {
  if (!cssText) return '';
  return cssText.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (match, quote, path) => {
    path = path.trim();
    if (!path || path.startsWith('data:') || path.startsWith('#') || path.startsWith('http://') || path.startsWith('https://')) {
      return match;
    }
    try {
      const absoluteUrl = new URL(path, stylesheetUrl).href;
      return `url("${absoluteUrl}")`;
    } catch (e) {
      return match;
    }
  });
}

async function fetchStylesheetText(url) {
  if (stylesheetCache.has(url)) {
    return stylesheetCache.get(url);
  }

  // 1. Fetch via background service worker (full extension privileges, bypasses CORS)
  try {
    const response = await chrome.runtime.sendMessage({ type: 'FETCH_STYLESHEET', url });
    if (response && response.success && response.cssText) {
      stylesheetCache.set(url, response.cssText);
      return response.cssText;
    }
  } catch (e) {}

  // 2. Fallback to direct fetch
  try {
    const res = await fetch(url);
    if (res.ok) {
      const text = await res.text();
      stylesheetCache.set(url, text);
      return text;
    }
  } catch (e) {}

  return null;
}

async function inlineSnapshotExternalStyles(html, baseUrl) {
  if (!html || typeof html !== 'string') return html;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Strip any CSP meta tags so they don't block inlined styles or fonts offline
    doc.querySelectorAll('meta[http-equiv="Content-Security-Policy" i], meta[http-equiv="content-security-policy" i]').forEach(m => m.remove());

    // Ensure <meta name="referrer" content="no-referrer"> to allow CDN images to load without hotlink blocking
    let refMeta = doc.querySelector('meta[name="referrer"]');
    if (!refMeta) {
      refMeta = doc.createElement('meta');
      refMeta.name = 'referrer';
      refMeta.content = 'no-referrer';
      const head = doc.querySelector('head') || doc.documentElement;
      head.insertBefore(refMeta, head.firstChild);
    } else {
      refMeta.setAttribute('content', 'no-referrer');
    }

    const links = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'));
    if (links.length > 0) {
      await Promise.all(links.map(async (link) => {
        const href = link.getAttribute('href');
        if (!href) return;
        try {
          const fullUrl = new URL(href, baseUrl || 'https://id.pinterest.com').href;
          const rawCss = await fetchStylesheetText(fullUrl);
          if (rawCss) {
            const rebasedCss = rebaseCssUrls(rawCss, fullUrl);
            const styleEl = doc.createElement('style');
            styleEl.setAttribute('data-inlined-href', fullUrl);
            styleEl.textContent = rebasedCss;
            link.replaceWith(styleEl);
          }
        } catch (err) {
          console.warn('[Rolling-WebICU] Could not inline stylesheet:', href, err);
        }
      }));
    }

    return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  } catch (err) {
    console.warn('[Rolling-WebICU] Error inlining snapshot styles:', err);
    return html;
  }
}

let currentPreviewSnapshot = null;
let currentPreviewBlobUrl = null;

async function openSnapshotModal(snap) {
  if (!snapshotPreviewModal || !snapshotModalIframe) return;
  currentPreviewSnapshot = snap;
  snapshotModalTitle.textContent = `Snapshot #${snap.snapshotIndex} [${snap.triggerReason}] - ${snap.url}`;

  if (currentPreviewBlobUrl) {
    URL.revokeObjectURL(currentPreviewBlobUrl);
    currentPreviewBlobUrl = null;
  }

  // Ensure external stylesheets are fetched and inlined into <style> tags
  let htmlContent = snap.html || '<!DOCTYPE html><html><body>No content</body></html>';
  htmlContent = await inlineSnapshotExternalStyles(htmlContent, snap.url);
  snap.html = htmlContent;

  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  currentPreviewBlobUrl = URL.createObjectURL(blob);
  snapshotModalIframe.src = currentPreviewBlobUrl;
  snapshotPreviewModal.style.display = 'flex';
}

if (btnOpenSnapshotNewTab) {
  btnOpenSnapshotNewTab.addEventListener('click', () => {
    if (currentPreviewBlobUrl) {
      window.open(currentPreviewBlobUrl, '_blank');
    }
  });
}

if (btnDownloadSnapshotModal) {
  btnDownloadSnapshotModal.addEventListener('click', async () => {
    if (!currentPreviewSnapshot) return;
    const inlinedHtml = await inlineSnapshotExternalStyles(currentPreviewSnapshot.html || '', currentPreviewSnapshot.url);
    const blob = new Blob([inlinedHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `snapshot_${String(currentPreviewSnapshot.snapshotIndex).padStart(3, '0')}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

if (btnCloseSnapshotModal) {
  btnCloseSnapshotModal.addEventListener('click', () => {
    snapshotPreviewModal.style.display = 'none';
    if (snapshotModalIframe) snapshotModalIframe.src = 'about:blank';
    if (currentPreviewBlobUrl) {
      URL.revokeObjectURL(currentPreviewBlobUrl);
      currentPreviewBlobUrl = null;
    }
    currentPreviewSnapshot = null;
  });
}

// --- Helper: Sanitize Events Stream to filter out sub-frame pollution ---
function sanitizeReplayEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return events;

  // 1. Identify primary desktop/tablet viewport from Meta (type 4) events
  const metaEvents = events.filter(e => e.type === 4 && e.data?.width > 0 && e.data?.height > 0);
  let maxArea = 0;
  let primaryMeta = null;
  for (const m of metaEvents) {
    const area = (m.data.width || 0) * (m.data.height || 0);
    if (area > maxArea) {
      maxArea = area;
      primaryMeta = m;
    }
  }

  // 2. Identify full snapshot node counts to protect main document
  function countNodes(node) {
    if (!node) return 0;
    let count = 1;
    if (Array.isArray(node.childNodes)) {
      for (const child of node.childNodes) {
        count += countNodes(child);
      }
    }
    return count;
  }

  let maxSnapshotNodes = 0;
  for (const ev of events) {
    if (ev.type === 2 && ev.data?.node) {
      const cnt = countNodes(ev.data.node);
      ev._cachedNodeCount = cnt;
      if (cnt > maxSnapshotNodes) {
        maxSnapshotNodes = cnt;
      }
    }
  }

  // 3. Filter out sub-iframe meta and mini-snapshots:
  // If a full desktop snapshot/viewport exists (e.g. maxArea >= 250,000 or maxSnapshotNodes >= 100):
  // Filter out any type 4 event with width < 500 or height < 300, or area < 150,000.
  // Filter out any type 2 event with < 60 nodes (an iframe widget masquerading as root).
  const sanitized = events.filter(ev => {
    // Drop sub-iframe viewport resize events
    if (ev.type === 4 && primaryMeta && maxArea >= 250000) {
      const area = (ev.data?.width || 0) * (ev.data?.height || 0);
      if (area < 150000 || (ev.data?.width < 500 && ev.data?.height < 300)) {
        return false;
      }
    }

    // Drop sub-iframe mini full snapshots
    if (ev.type === 2 && maxSnapshotNodes >= 100) {
      const cnt = ev._cachedNodeCount !== undefined ? ev._cachedNodeCount : countNodes(ev.data?.node);
      if (cnt < 60) {
        return false;
      }
    }

    return true;
  });

  // 4. Neutralize script tags to prevent replay CSP blocks and foreign script execution
  function neutralizeScriptNode(node) {
    if (!node) return;
    if (node.tagName === 'script') {
      node.tagName = 'noscript';
      if (node.attributes) {
        delete node.attributes.src;
        delete node.attributes.crossorigin;
        delete node.attributes.type;
        delete node.attributes.integrity;
      }
      node.childNodes = [];
    }
    if (Array.isArray(node.childNodes)) {
      for (const child of node.childNodes) {
        neutralizeScriptNode(child);
      }
    }
  }

  for (const ev of sanitized) {
    if (ev.type === 2 && ev.data?.node) {
      neutralizeScriptNode(ev.data.node);
    } else if (ev.type === 3 && ev.data?.adds) {
      for (const add of ev.data.adds) {
        if (add.node) neutralizeScriptNode(add.node);
      }
    }
  }

  return sanitized;
}

const DEFAULT_README_INSTRUCTION_TEXT = '================================================================================\n' +
  '                    WELCOME. Exported from WebICU.\n' +
  '================================================================================\n\n' +
  'Greetings! Whether you are a human developer, a data scientist, a reverse\n' +
  'engineer, a robot(we\'re not racist to robot promise!), or a cat parsing this archive:\n\n' +
  'You are now a surgeon, that\'s all. Bye.\n\n' +
  '================================================================================\n' +
  '                                  HOW TO PLAY\n' +
  '================================================================================\n\n' +
  'This archive includes query_session.js — a standalone inspection tool requiring\n' +
  'only standard Node.js.\n\n' +
  'Run: node query_session.js --summary\n\n' +
  'Refer to README_INSTRUCTION.txt for the comprehensive manual.\n\n' +
  '================================================================================\n' +
  '                    WebICU - I see you in ICU.\n' +
  '================================================================================\n';

// --- Structured ZIP Archive Exporter ---
async function exportSessionZip(sessionId) {
  const session = await db.getSession(sessionId);
  let events = await db.getEvents(sessionId);
  if (!session) return;

  events = sanitizeReplayEvents(events);
  parseSessionStructures(events, session);

  const zip = new ZipWriter();
  const safeName = (session.name || 'session').replace(/[^a-z0-9_-]/gi, '_');
  const shortId = session.id.replace('session_', '').substring(0, 8);

  const metaEvents = events.filter(e => e.type === 4 && e.data?.width > 0 && e.data?.height > 0);
  let exportMeta = null;
  if (metaEvents.length > 0) {
    exportMeta = [...metaEvents].sort((a, b) => (b.data.width * b.data.height) - (a.data.width * a.data.height))[0];
  }
  const expWidth = exportMeta?.data?.width || currentNativeWidth || 1280;
  const expHeight = exportMeta?.data?.height || currentNativeHeight || 720;

  // 1. Manifest
  const manifest = {
    sessionId: session.id,
    sessionName: session.name,
    targetUrl: session.url,
    recordedTimestamp: session.createTimestamp,
    durationMs: session.durationMs,
    totalEventsCount: events.length,
    progressiveSnapshotsCount: parsedSnapshots.length,
    semanticActionsCount: parsedActions.length,
    networkRequestsCount: parsedNetwork.length,
    captureEngine: session.captureEngine || 'STEALTH_MV3',
    recordedResolution: {
      width: expWidth,
      height: expHeight
    },
    exportDate: new Date().toISOString()
  };
  await zip.addFile('manifest.json', manifest);

  // 2. Progressive Snapshots (.html)
  for (const snap of parsedSnapshots) {
    const filename = `snapshots/snapshot_${String(snap.snapshotIndex).padStart(3, '0')}_${snap.triggerReason.toLowerCase()}.html`;
    const inlinedHtml = await inlineSnapshotExternalStyles(snap.html, snap.url);
    await zip.addFile(filename, inlinedHtml || '<!DOCTYPE html><html><body>No content</body></html>');
  }

  // 3. Lossless Network Dump (NetworkDump_FullCapture/)
  const networkIndex = [];
  for (let i = 0; i < parsedNetwork.length; i++) {
    const req = parsedNetwork[i];
    let endpointSlug = 'endpoint';
    try {
      const u = new URL(req.url, 'http://localhost');
      const segments = u.pathname.split('/').filter(Boolean);
      endpointSlug = (segments[segments.length - 1] || 'endpoint').replace(/[^a-z0-9_-]/gi, '_').substring(0, 25);
    } catch (_) {}

    const dumpFileName = `NetworkDump_FullCapture/req_${String(i + 1).padStart(3, '0')}_${req.method}_${endpointSlug}.json`;

    // Lossless full payload
    const losslessPayload = {
      requestId: req.requestId,
      associatedActionId: req.associatedActionId,
      initiator: req.initiator,
      timestamp: req.startTime,
      durationMs: req.durationMs,
      method: req.method,
      url: req.url,
      status: req.status,
      statusText: req.statusText,
      requestHeaders: req.requestHeaders,
      requestBody: req.requestBody,
      responseHeaders: req.responseHeaders,
      responseBody: req.responseBody,
      error: req.error
    };
    await zip.addFile(dumpFileName, losslessPayload);

    networkIndex.push({
      index: i + 1,
      requestId: req.requestId,
      associatedActionId: req.associatedActionId,
      method: req.method,
      url: req.url,
      status: req.status,
      durationMs: req.durationMs,
      relativeTimeMs: req.relativeTimeMs,
      dumpFile: dumpFileName
    });
  }
  await zip.addFile('NetworkDump_FullCapture/network_index.json', networkIndex);

  // 4. Actions and Causality (.json) with linked dump files
  const actionsWithNetworkLinks = parsedActions.map(act => {
    const linkedReqs = parsedNetwork.filter(r => r.associatedActionId === act.actionId);
    return {
      ...act,
      associated_network_requests: linkedReqs.map(r => {
        const idxEntry = networkIndex.find(ni => ni.requestId === r.requestId);
        return {
          requestId: r.requestId,
          method: r.method,
          url: r.url,
          status: r.status,
          durationMs: r.durationMs,
          dumpFile: idxEntry ? idxEntry.dumpFile : null
        };
      })
    };
  });
  await zip.addFile('actions_and_causality.json', actionsWithNetworkLinks);

  // 5. Chronological Activity Timeline (.json)
  const timeline = events.map(e => ({
    type: EVENT_TYPE_NAMES[e.type] || ('Type_' + e.type),
    timestamp: e.timestamp,
    relativeOffsetMs: e.timestamp - (events[0]?.timestamp || 0),
    summary: JSON.stringify(e.data || {}).substring(0, 100)
  }));
  await zip.addFile('activity_timeline.json', timeline);

  // 6. Raw event stream (.json) for backup replay
  await zip.addFile('raw_events.json', events);
  await zip.addFile('raw_rrweb_events.json', events);

  // 7. Zero-dependency CLI session inspector (query_session.js)
  try {
    const cliUrl = (typeof chrome !== 'undefined' && chrome.runtime?.getURL) ? chrome.runtime.getURL('query_session.js') : '../query_session.js';
    const cliRes = await fetch(cliUrl);
    if (cliRes.ok) {
      const cliContent = await cliRes.text();
      await zip.addFile('query_session.js', cliContent);
    }
  } catch (err) {
    console.warn('Could not bundle query_session.js into export:', err);
  }

  // 8. Welcome & Instruction Manual (README_INSTRUCTION.txt)
  try {
    const readmeUrl = (typeof chrome !== 'undefined' && chrome.runtime?.getURL) ? chrome.runtime.getURL('README_INSTRUCTION.txt') : '../README_INSTRUCTION.txt';
    const readmeRes = await fetch(readmeUrl);
    if (readmeRes.ok) {
      const readmeContent = await readmeRes.text();
      await zip.addFile('README_INSTRUCTION.txt', readmeContent);
    } else {
      throw new Error('README fetch non-ok');
    }
  } catch (_) {
    await zip.addFile('README_INSTRUCTION.txt', DEFAULT_README_INSTRUCTION_TEXT);
  }

  // Generate ZIP blob and trigger download
  const zipBlob = zip.generateZipBlob();
  const downloadUrl = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = `session_${safeName}_${shortId}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(downloadUrl);
}

// Button listeners
if (btnExportZipArchive) {
  btnExportZipArchive.addEventListener('click', () => {
    if (currentLoadedSessionId) {
      exportSessionZip(currentLoadedSessionId);
    }
  });
}

async function openPlayer(sessionId) {
  stopCurrentPlayback();
  currentLoadedSessionId = sessionId;
  const session = await db.getSession(sessionId);
  const rawEvents = await db.getEvents(sessionId);

  if (!session) {
    alert('Session not found in IndexedDB.');
    return;
  }

  // Sanitize events to eliminate sub-iframe collapses and mini meta resize events
  loadedEvents = sanitizeReplayEvents(rawEvents) || [];

  // Extract native recording resolution from largest meta event (type 4)
  const metaEvents = loadedEvents.filter(e => e.type === 4 && e.data?.width > 0 && e.data?.height > 0);
  let primaryMeta = null;
  if (metaEvents.length > 0) {
    primaryMeta = [...metaEvents].sort((a, b) => {
      const areaA = (a.data.width || 0) * (a.data.height || 0);
      const areaB = (b.data.width || 0) * (b.data.height || 0);
      return areaB - areaA;
    })[0];
  }
  currentNativeWidth = primaryMeta?.data?.width || 1280;
  currentNativeHeight = primaryMeta?.data?.height || 720;

  const shortKey = session.id.replace('session_', '#').substring(0, 8);
  const fullTitle = `${session.name || 'Untitled Session'} (${shortKey})`;
  if (playerSessionTitle) {
    playerSessionTitle.textContent = fullTitle;
    playerSessionTitle.title = fullTitle;
  }
  if (playerUrlDisplay) {
    playerUrlDisplay.textContent = session.url || 'chrome-extension://local-session';
    playerUrlDisplay.title = session.url || '';
  }

  if (playerMetaBadges) {
    const isCdp = session.captureEngine === 'CDP_DEBUGGER';
    const engineBadge = isCdp
      ? `<span class="stat-chip" style="background: #fef2f2; border-color: var(--color-primary); color: var(--color-primary);" title="Captured via Chrome DevTools Protocol">${SVG_ICONS.cdp} CDP Engine</span>`
      : `<span class="stat-chip" title="Captured via Stealth MV3">${SVG_ICONS.spark} Stealth MV3</span>`;

    playerMetaBadges.innerHTML = `
      <span class="stat-chip">${SVG_ICONS.clock} ${formatDuration(session.durationMs)}</span>
      <span class="stat-chip">${SVG_ICONS.pulse} ${loadedEvents.length} events</span>
      <span class="stat-chip" title="Recorded viewport dimensions">${SVG_ICONS.dim} ${currentNativeWidth}×${currentNativeHeight}</span>
      ${engineBadge}
    `;
  }

  // Parse Causality, Progressive Snapshots & Network from events
  parseSessionStructures(loadedEvents, session);
  renderActionsCausality();
  renderProgressiveSnapshots();
  renderNetworkWaterfall();

  // Switch to player view and guarantee zero scroll
  switchView('player');

  // Clean existing player mount
  if (rrwebPlayerMount) rrwebPlayerMount.innerHTML = '';

  if (!loadedEvents || loadedEvents.length === 0) {
    if (rrwebPlayerMount) {
      rrwebPlayerMount.innerHTML = `
        <div style="padding: 60px 20px; color: #a1a1aa; text-align: center; font-family: var(--font-display);">
          No interaction events captured in this session.
        </div>
      `;
    }
    if (eventInspectorCount) eventInspectorCount.textContent = '0';
    if (eventTableBody) eventTableBody.innerHTML = '';
    if (rawJsonViewer) rawJsonViewer.textContent = '// No payload events available';
    if (playbackBarContainer) {
      playbackBarContainer.style.opacity = '0.4';
      playbackBarContainer.style.pointerEvents = 'none';
    }
    return;
  }

  if (playbackBarContainer) {
    playbackBarContainer.style.opacity = '1';
    playbackBarContainer.style.pointerEvents = 'auto';
  }

  try {
    const dims = calculateStageDimensions();

    activePlayerInstance = new window.rrwebPlayer({
      target: rrwebPlayerMount,
      props: {
        events: loadedEvents,
        autoPlay: true,
        showController: false,
        width: dims.width,
        height: dims.height
      }
    });

    const replayer = getReplayerInstance(activePlayerInstance);
    initPlaybackBar(replayer, loadedEvents);

    // Setup ResizeObserver for theater container to auto-fit any screen size / fullscreen
    if (window.ResizeObserver && stageViewportContainer) {
      if (stageResizeObserver) stageResizeObserver.disconnect();
      stageResizeObserver = new ResizeObserver(() => {
        if (!activePlayerInstance || !currentLoadedSessionId) return;
        clearTimeout(stageResizeTimeout);
        stageResizeTimeout = setTimeout(updatePlayerDimensions, 50);
      });
      stageResizeObserver.observe(stageViewportContainer);
    }
  } catch (err) {
    console.error('Failed to initialize rrwebPlayer:', err);
    if (rrwebPlayerMount) {
      rrwebPlayerMount.innerHTML = `
        <div style="padding: 40px; color: var(--color-primary); text-align: center; font-family: var(--font-mono);">
          Replayer initialization failed: ${err.message}
        </div>
      `;
    }
  }

  // Populate DevTools raw event inspector (Tab 3)
  renderEventInspector();
}

function renderEventInspector() {
  const query = (eventFilterInput ? eventFilterInput.value : '').trim().toLowerCase();
  const initialTimestamp = loadedEvents.length > 0 ? loadedEvents[0].timestamp : 0;

  let filtered = loadedEvents.filter((ev) => {
    if (currentFilterType === 'snapshot' && ev.type !== 2) return false;
    if (currentFilterType === 'mutation' && ev.type !== 3) return false;
    if (!query) return true;

    const typeStr = (EVENT_TYPE_NAMES[ev.type] || '').toLowerCase();
    const summary = JSON.stringify(ev.data || {}).toLowerCase();
    return typeStr.includes(query) || summary.includes(query);
  });

  if (eventInspectorCount) eventInspectorCount.textContent = `${filtered.length}`;
  if (!eventTableBody) return;
  eventTableBody.innerHTML = '';

  const displayLimit = Math.min(filtered.length, 250);

  for (let i = 0; i < displayLimit; i++) {
    const ev = filtered[i];
    const row = document.createElement('tr');
    row.className = 'event-row';

    const typeLabel = EVENT_TYPE_NAMES[ev.type] || `Type ${ev.type}`;
    const relTime = formatDuration(ev.timestamp - initialTimestamp);

    let badgeClass = 'event-badge-meta';
    if (ev.type === 2) badgeClass = 'event-badge-snap';
    else if (ev.type === 3) badgeClass = 'event-badge-mut';
    else if (ev.type === 5) badgeClass = 'event-badge-custom';

    let summary = '';
    if (ev.type === 2) summary = 'Full DOM snapshot';
    else if (ev.type === 3) summary = `Mutation (source: ${ev.data?.source ?? 'unknown'})`;
    else if (ev.type === 4) summary = `Viewport: ${ev.data?.width || 0}×${ev.data?.height || 0}`;
    else if (ev.type === 5) summary = `Custom [${ev.data?.tag || ''}]`;
    else summary = JSON.stringify(ev.data || {}).substring(0, 50);

    row.innerHTML = `
      <td>#${i + 1}</td>
      <td><span class="event-badge ${badgeClass}">${typeLabel}</span></td>
      <td>+${relTime}</td>
      <td class="event-summary-cell">${escapeHtml(summary)}</td>
    `;

    row.addEventListener('click', () => {
      document.querySelectorAll('.event-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      inspectEventDetails(ev, i + 1);
    });

    eventTableBody.appendChild(row);
  }

  // Pre-select first event
  if (filtered.length > 0) {
    inspectEventDetails(filtered[0], 1);
  }
}

function inspectEventDetails(ev, index) {
  currentlySelectedEvent = ev;
  if (selectedEventHeader) {
    selectedEventHeader.textContent = `Event #${index} [${EVENT_TYPE_NAMES[ev.type] || 'Type ' + ev.type}]`;
  }
  if (rawJsonViewer) {
    rawJsonViewer.textContent = JSON.stringify(ev, null, 2);
  }
}

// DevTools filter listeners
if (eventFilterInput) {
  eventFilterInput.addEventListener('input', () => {
    renderEventInspector();
  });
}

eventFilterPills.forEach(pill => {
  pill.addEventListener('click', () => {
    eventFilterPills.forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    currentFilterType = pill.dataset.type;
    renderEventInspector();
  });
});

async function exportSessionJson(sessionId) {
  const session = await db.getSession(sessionId);
  const events = await db.getEvents(sessionId);
  if (!session) return;

  const data = {
    session,
    events
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = (session.name || 'session').replace(/[^a-z0-9_-]/gi, '_');
  a.download = `${safeName}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Storage Hub calculations
async function renderStorageStats() {
  let sessions = [];
  try {
    sessions = (await db.getAllSessions()) || [];
  } catch (err) {
    console.error('[WebICU Dashboard] renderStorageStats error:', err);
  }
  let totalEvents = 0;

  for (const s of sessions) {
    totalEvents += (s.eventCount || 0);
  }

  const estBytes = totalEvents * 420;
  const estMb = (estBytes / (1024 * 1024)).toFixed(2);

  if (storageAllocationBadge) storageAllocationBadge.textContent = `${estMb} MB Used`;
  if (storageDomText) storageDomText.textContent = `${sessions.length} Sessions`;
  if (storageMutText) storageMutText.textContent = `${totalEvents.toLocaleString()} Events`;
  if (storagePayloadText) storagePayloadText.textContent = `${estMb} MB`;
}

// Export All Bundle
if (btnExportAllBundle) {
  btnExportAllBundle.addEventListener('click', async () => {
    const sessions = await db.getAllSessions();
    const fullArchive = [];

    for (const s of sessions) {
      const events = await db.getEvents(s.id);
      fullArchive.push({ session: s, events });
    }

    const blob = new Blob([JSON.stringify(fullArchive, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rolling_webicu_backup_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

// Clear DB from Storage Hub
if (btnClearStorageDb) {
  btnClearStorageDb.addEventListener('click', async () => {
    if (confirm('Delete all recorded sessions permanently? This action cannot be undone.')) {
      await db.clearAllSessions();
      await renderSessionsList();
      await renderStorageStats();
      switchView('sessions');
    }
  });
}

// Import JSON file
if (importJsonInput) {
  importJsonInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      let session = null;
      let events = [];

      if (Array.isArray(data)) {
        events = data;
        session = {
          id: 'session_' + Date.now() + '_imp',
          name: file.name.replace(/\.json$/i, ''),
          url: 'Imported Archive',
          createTimestamp: Date.now(),
          durationMs: events.length > 1 ? events[events.length - 1].timestamp - events[0].timestamp : 0,
          eventCount: events.length
        };
      } else if (data && Array.isArray(data.events)) {
        events = data.events;
        session = data.session || {
          id: 'session_' + Date.now() + '_imp',
          name: file.name.replace(/\.json$/i, ''),
          url: 'Imported Archive',
          createTimestamp: Date.now()
        };
        session.eventCount = events.length;
        if (!session.durationMs && events.length > 1) {
          session.durationMs = events[events.length - 1].timestamp - events[0].timestamp;
        }
      } else {
        throw new Error('Unrecognized session format.');
      }

      await db.saveSession(session, events);
      importJsonInput.value = '';
      await renderSessionsList();
      openPlayer(session.id);
    } catch (err) {
      alert('Failed to import session JSON: ' + err.message);
    }
  });
}

if (clearAllBtn) {
  clearAllBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to delete ALL recorded sessions? This action cannot be undone.')) {
      await db.clearAllSessions();
      await renderSessionsList();
    }
  });
}

if (backToListBtn) {
  backToListBtn.addEventListener('click', () => {
    switchView('sessions');
    renderSessionsList();
  });
}

if (exportCurrentBtn) {
  exportCurrentBtn.addEventListener('click', () => {
    if (currentLoadedSessionId) {
      exportSessionJson(currentLoadedSessionId);
    }
  });
}

if (deleteCurrentBtn) {
  deleteCurrentBtn.addEventListener('click', async () => {
    if (currentLoadedSessionId && confirm('Delete this session from IndexedDB?')) {
      await db.deleteSession(currentLoadedSessionId);
      switchView('sessions');
      await renderSessionsList();
    }
  });
}

if (searchInput) {
  searchInput.addEventListener('input', () => {
    renderSessionsList();
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Background recording status sync
function syncRecordingStatus() {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
      if (chrome.runtime.lastError || !res) return;
      if (!navRecordingBadge) return;
      if (res.status === 'RECORDING') {
        navRecordingBadge.textContent = 'REC ACTIVE';
        navRecordingBadge.className = 'nav-status-badge status-active';
      } else if (res.status === 'PAUSED') {
        navRecordingBadge.textContent = 'PAUSED';
        navRecordingBadge.className = 'nav-status-badge status-paused';
      } else {
        navRecordingBadge.textContent = 'STANDBY';
        navRecordingBadge.className = 'nav-status-badge';
      }
    });
  }
}

// Initialize listeners
setupPlaybackListeners();

// Initial bootstrap
(async () => {
  const params = new URLSearchParams(window.location.search);
  const targetSessionId = params.get('session');

  try {
    await renderSessionsList();
  } catch (renderErr) {
    console.error('[WebICU Dashboard] Initial renderSessionsList error:', renderErr);
    if (emptyState) emptyState.style.display = 'flex';
  }

  syncRecordingStatus();
  setInterval(syncRecordingStatus, 3000);

  if (targetSessionId) {
    try {
      const exists = await db.getSession(targetSessionId);
      if (exists) {
        await openPlayer(targetSessionId);
      }
    } catch (openErr) {
      console.error('[WebICU Dashboard] Initial openPlayer error for session ' + targetSessionId, openErr);
      switchView('sessions');
    }
  }
})();
