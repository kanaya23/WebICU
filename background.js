// background.js - Service worker coordinating recorder state, tabs, and persistence
import * as db from './db.js';

let state = {
  status: 'IDLE', // 'IDLE' | 'RECORDING' | 'PAUSED'
  activeTabId: null,
  sessionId: null,
  sessionTitle: '',
  sessionUrl: '',
  startTimestamp: null,
  pausedTimestamp: null,
  accumulatedPausedMs: 0,
  eventCount: 0,
  useCdp: false,
  captureEngine: 'STEALTH_MV3'
};

// --- CDP Debugger Engine State & Handlers ---
let cdpAttachedTabId = null;

async function attachCdpDebugger(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    cdpAttachedTabId = tabId;

    // Enable Network domain for raw network & WebSocket packet inspection
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable', {
      maxTotalBufferSize: 10000000,
      maxResourceBufferSize: 5000000
    });

    console.log('[WebICU] Attached CDP debugger to tab:', tabId);
  } catch (err) {
    console.warn('[WebICU] Could not attach CDP debugger:', err);
    cdpAttachedTabId = null;
  }
}

async function detachCdpDebugger(tabId) {
  const targetId = tabId || cdpAttachedTabId;
  if (!targetId) return;

  try {
    await chrome.debugger.detach({ tabId: targetId });
    console.log('[WebICU] Detached CDP debugger from tab:', targetId);
  } catch (e) {}
  if (targetId === cdpAttachedTabId) cdpAttachedTabId = null;
}

// Listen to CDP events when in CDP Debugger mode
chrome.debugger.onEvent.addListener(async (source, method, params) => {
  if (state.status !== 'RECORDING' || !state.sessionId || source.tabId !== state.activeTabId) {
    return;
  }

  const now = Date.now();

  // 1. WebSocket Connection Opened
  if (method === 'Network.webSocketCreated') {
    const wsEvent = {
      type: 5,
      timestamp: now,
      data: {
        tag: 'rolling-network',
        payload: {
          requestId: 'ws_' + (params.requestId || now),
          associatedActionId: null,
          initiator: 'cdp_websocket',
          method: 'WS',
          url: params.url || '',
          startTime: now,
          endTime: now,
          durationMs: 0,
          status: 101,
          statusText: 'Switching Protocols (WebSocket)',
          requestHeaders: params.initiator || {},
          requestBody: null,
          responseHeaders: {},
          responseBody: `WebSocket connection opened to ${params.url}`,
          error: null
        }
      }
    };
    state.eventCount++;
    state.currentChunkIndex = (state.currentChunkIndex || 0) + 1;
    await db.appendEventChunk(state.sessionId, [wsEvent], state.currentChunkIndex);
    scheduleStorageThrottledSync();
  }

  // 2. WebSocket Frame Sent
  else if (method === 'Network.webSocketFrameSent') {
    const frame = params.response || {};
    const payloadStr = frame.payloadData 
      ? (frame.payloadData.length > 2000 ? frame.payloadData.substring(0, 2000) + '... (truncated)' : frame.payloadData)
      : `[Binary Frame opcode:${frame.opcode || '?'}${frame.mask ? ' masked' : ''}]`;

    const wsFrameEvent = {
      type: 5,
      timestamp: now,
      data: {
        tag: 'rolling-network',
        payload: {
          requestId: 'ws_frame_' + now + '_' + Math.random().toString(36).substring(2, 6),
          associatedActionId: null,
          initiator: 'websocket_sent',
          method: 'WS_SEND',
          url: `WebSocket Frame (Opcode: ${frame.opcode})`,
          startTime: now,
          endTime: now,
          durationMs: 0,
          status: 200,
          statusText: 'Frame Sent',
          requestHeaders: { opcode: frame.opcode },
          requestBody: payloadStr,
          responseHeaders: {},
          responseBody: null,
          error: null
        }
      }
    };
    state.eventCount++;
    state.currentChunkIndex = (state.currentChunkIndex || 0) + 1;
    await db.appendEventChunk(state.sessionId, [wsFrameEvent], state.currentChunkIndex);
    scheduleStorageThrottledSync();
  }

  // 3. WebSocket Frame Received
  else if (method === 'Network.webSocketFrameReceived') {
    const frame = params.response || {};
    const payloadStr = frame.payloadData 
      ? (frame.payloadData.length > 2000 ? frame.payloadData.substring(0, 2000) + '... (truncated)' : frame.payloadData)
      : `[Binary Frame opcode:${frame.opcode || '?'}]`;

    const wsRecvEvent = {
      type: 5,
      timestamp: now,
      data: {
        tag: 'rolling-network',
        payload: {
          requestId: 'ws_recv_' + now + '_' + Math.random().toString(36).substring(2, 6),
          associatedActionId: null,
          initiator: 'websocket_recv',
          method: 'WS_RECV',
          url: `WebSocket Inbound Frame (Opcode: ${frame.opcode})`,
          startTime: now,
          endTime: now,
          durationMs: 0,
          status: 200,
          statusText: 'Frame Received',
          requestHeaders: {},
          requestBody: null,
          responseHeaders: { opcode: frame.opcode },
          responseBody: payloadStr,
          error: null
        }
      }
    };
    state.eventCount++;
    state.currentChunkIndex = (state.currentChunkIndex || 0) + 1;
    await db.appendEventChunk(state.sessionId, [wsRecvEvent], state.currentChunkIndex);
    scheduleStorageThrottledSync();
  }
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (cdpAttachedTabId === source.tabId) {
    cdpAttachedTabId = null;
    console.log('[WebICU] Debugger detached:', reason);
  }
});

// Throttled storage sync to eliminate 20Hz disk I/O throttling
let storageSyncTimer = null;
function scheduleStorageThrottledSync() {
  if (storageSyncTimer) return;
  storageSyncTimer = setTimeout(() => {
    storageSyncTimer = null;
    syncStateToStorage();
  }, 2500);
}

// Persist state in chrome.storage so service worker restarts don't lose track
async function syncStateToStorage() {
  await chrome.storage.local.set({ webicu_state: state });
}

async function restoreStateFromStorage() {
  const data = await chrome.storage.local.get(['webicu_state', 'rrweb_state']);
  const savedState = data && (data.webicu_state || data.rrweb_state);
  if (savedState) {
    state = Object.assign(state, savedState);
    updateBadge();
  }
}

function updateBadge() {
  if (state.status === 'RECORDING') {
    chrome.action.setBadgeText({ text: 'REC' });
    chrome.action.setBadgeBackgroundColor({ color: '#E53E3E' });
  } else if (state.status === 'PAUSED') {
    chrome.action.setBadgeText({ text: 'PAUSE' });
    chrome.action.setBadgeBackgroundColor({ color: '#DD6B20' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// Handle long-lived stream ports from content scripts
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'webicu-stream' && port.name !== 'rrweb-stream') return;

  // Never accept event streams from sub-iframes or embedded widgets
  if (typeof port.sender?.frameId === 'number' && port.sender.frameId !== 0) {
    try { port.disconnect(); } catch (e) {}
    return;
  }

  const senderTabId = port.sender?.tab?.id;

  port.onMessage.addListener(async (msg) => {
    if (!msg || !msg.type) return;

    if (msg.type === 'EVENTS_BATCH' && Array.isArray(msg.events) && msg.events.length > 0) {
      if (state.status === 'RECORDING' && state.sessionId) {
        state.eventCount += msg.events.length;
        state.currentChunkIndex = (state.currentChunkIndex || 0) + 1;
        // High-performance O(1) chunk write: writes ONLY this batch
        await db.appendEventChunk(state.sessionId, msg.events, state.currentChunkIndex);
        scheduleStorageThrottledSync();
      }
    }
  });
});

// Handle requests from popup, content scripts, and dashboard
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  (async () => {
    try {
      switch (message.type) {
      case 'GET_STATUS': {
        sendResponse({
          ...state,
          currentDurationMs: state.startTimestamp && state.status === 'RECORDING'
            ? Date.now() - state.startTimestamp - state.accumulatedPausedMs
            : 0
        });
        break;
      }

      case 'QUERY_TAB_RECORDING': {
        const isTargetTab = sender.tab && sender.tab.id === state.activeTabId;
        sendResponse({
          shouldRecord: isTargetTab && state.status === 'RECORDING',
          sessionId: state.sessionId
        });
        break;
      }

      case 'START_RECORDING': {
        try {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!activeTab || !activeTab.id) {
            sendResponse({ success: false, error: 'No active tab found' });
            return;
          }

          // Generate new session
          const now = Date.now();
          const sessionId = 'session_' + now + '_' + Math.random().toString(36).substring(2, 8);
          const title = activeTab.title || 'Session ' + new Date().toLocaleString();
          const url = activeTab.url || '';

          const useCdp = !!message.useCdp;
          const engine = useCdp ? 'CDP_DEBUGGER' : 'STEALTH_MV3';

          const newSession = {
            id: sessionId,
            name: title,
            url: url,
            captureEngine: engine,
            createTimestamp: now,
            durationMs: 0,
            eventCount: 0
          };

          await db.saveSession(newSession, []);

          state = {
            status: 'RECORDING',
            activeTabId: activeTab.id,
            sessionId: sessionId,
            sessionTitle: title,
            sessionUrl: url,
            startTimestamp: now,
            pausedTimestamp: null,
            accumulatedPausedMs: 0,
            eventCount: 0,
            useCdp: useCdp,
            captureEngine: engine
          };

          updateBadge();
          await syncStateToStorage();

          // 1. Inject rrweb and inject.js directly into MAIN world via chrome.scripting.executeScript
          // This completely bypasses target website CSP (including WhatsApp Web, GitHub, etc.) and Trusted Types!
          try {
            await chrome.scripting.executeScript({
              target: { tabId: activeTab.id },
              world: 'MAIN',
              files: ['vendor/rrweb.umd.js', 'content/inject.js']
            });
          } catch (injectMainErr) {
            console.warn('[WebICU] Main world executeScript warning:', injectMainErr);
          }

          // 2. Ensure content script is running in ISOLATED world
          try {
            await chrome.scripting.executeScript({
              target: { tabId: activeTab.id, allFrames: false },
              files: ['content/content.js']
            });
          } catch (injectIsoErr) {}

          // 3. If CDP Debugger is requested, attach to DevTools protocol
          if (useCdp) {
            await attachCdpDebugger(activeTab.id);
          }

          // 4. Send START_RECORD to content script
          try {
            await chrome.tabs.sendMessage(activeTab.id, { type: 'START_RECORD' });
          } catch (tabErr) {
            console.warn('[WebICU] Tab message error:', tabErr);
          }

          sendResponse({ success: true, sessionId, engine });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
        break;
      }

      case 'PAUSE_RECORDING': {
        if (state.status !== 'RECORDING') {
          sendResponse({ success: false, error: 'Not currently recording' });
          return;
        }

        if (state.activeTabId) {
          try {
            await chrome.tabs.sendMessage(state.activeTabId, { type: 'STOP_RECORD' });
          } catch (e) {}
        }

        state.status = 'PAUSED';
        state.pausedTimestamp = Date.now();
        updateBadge();
        await syncStateToStorage();

        sendResponse({ success: true });
        break;
      }

      case 'RESUME_RECORDING': {
        if (state.status !== 'PAUSED') {
          sendResponse({ success: false, error: 'Not currently paused' });
          return;
        }

        if (state.pausedTimestamp) {
          state.accumulatedPausedMs += Date.now() - state.pausedTimestamp;
          state.pausedTimestamp = null;
        }

        state.status = 'RECORDING';
        updateBadge();
        await syncStateToStorage();

        if (state.activeTabId) {
          try {
            await chrome.tabs.sendMessage(state.activeTabId, { type: 'START_RECORD' });
          } catch (e) {}
        }

        sendResponse({ success: true });
        break;
      }

      case 'STOP_RECORDING': {
        if (state.status === 'IDLE') {
          sendResponse({ success: false, error: 'Recording is already stopped' });
          return;
        }

        // 1. Immediately cancel any scheduled throttled storage sync
        if (storageSyncTimer) {
          clearTimeout(storageSyncTimer);
          storageSyncTimer = null;
        }

        const stoppedSessionId = state.sessionId;
        const totalDuration = state.startTimestamp
          ? Date.now() - state.startTimestamp - state.accumulatedPausedMs
          : 0;

        // 2. Notify content script to stop with strict timeout watchdog (max 400ms)
        if (state.activeTabId) {
          try {
            await Promise.race([
              chrome.tabs.sendMessage(state.activeTabId, { type: 'STOP_RECORD' }).catch(() => {}),
              new Promise(r => setTimeout(r, 400))
            ]);
          } catch (e) {}
        }

        // 3. Detach CDP debugger if attached (max 400ms)
        if (state.useCdp || cdpAttachedTabId) {
          try {
            await Promise.race([
              detachCdpDebugger(state.activeTabId || cdpAttachedTabId),
              new Promise(r => setTimeout(r, 400))
            ]);
          } catch (e) {}
        }

        // 4. Finalize session in DB with strict timeout watchdog (max 1200ms)
        if (stoppedSessionId) {
          try {
            await Promise.race([
              (async () => {
                let session = await db.getSession(stoppedSessionId);
                if (session) {
                  session.durationMs = Math.max(0, totalDuration);
                  session.eventCount = state.eventCount;
                  await db.updateSession(session);
                } else {
                  session = {
                    id: stoppedSessionId,
                    name: state.sessionTitle || 'Session ' + new Date().toLocaleString(),
                    url: state.sessionUrl || '',
                    captureEngine: state.captureEngine || 'STEALTH_MV3',
                    createTimestamp: state.startTimestamp || Date.now(),
                    durationMs: Math.max(0, totalDuration),
                    eventCount: state.eventCount
                  };
                  await db.saveSession(session, []);
                }
              })(),
              new Promise(r => setTimeout(r, 1200))
            ]);
          } catch (dbErr) {
            console.warn('[WebICU] Session finalize DB warning:', dbErr);
          }
        }

        state = {
          status: 'IDLE',
          activeTabId: null,
          sessionId: null,
          sessionTitle: '',
          sessionUrl: '',
          startTimestamp: null,
          pausedTimestamp: null,
          accumulatedPausedMs: 0,
          eventCount: 0,
          currentChunkIndex: 0,
          useCdp: false,
          captureEngine: 'STEALTH_MV3'
        };

        updateBadge();
        await syncStateToStorage();

        sendResponse({ success: true, sessionId: stoppedSessionId });
        break;
      }

      case 'FETCH_STYLESHEET': {
        try {
          const res = await fetch(message.url);
          if (res.ok) {
            const cssText = await res.text();
            sendResponse({ success: true, cssText });
          } else {
            sendResponse({ success: false, status: res.status });
          }
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
        break;
      }

      case 'OPEN_DASHBOARD': {
        const dashboardUrl = chrome.runtime.getURL('dashboard/dashboard.html');
        const queryParams = message.sessionId ? `?session=${encodeURIComponent(message.sessionId)}` : '';
        const targetUrl = dashboardUrl + queryParams;

        const tabs = await chrome.tabs.query({ url: dashboardUrl + '*' });
        if (tabs.length > 0) {
          await chrome.tabs.update(tabs[0].id, { active: true, url: targetUrl });
          await chrome.windows.update(tabs[0].windowId, { focused: true });
        } else {
          await chrome.tabs.create({ url: targetUrl });
        }
        sendResponse({ success: true });
        break;
      }
    }
    } catch (unhandledErr) {
      console.error('[WebICU] Unhandled message error in background:', unhandledErr);
      try {
        sendResponse({ success: false, error: unhandledErr?.message || 'Internal error' });
      } catch (_) {}
    }
  })();

  return true; // Keep channel open for async response
});

// Listen for tab removals to handle closed recording tab
chrome.tabs.onRemoved.addListener((tabId) => {
  if (cdpAttachedTabId === tabId) {
    detachCdpDebugger(tabId);
  }
  if (state.status === 'RECORDING' && state.activeTabId === tabId) {
    state.status = 'PAUSED';
    state.pausedTimestamp = Date.now();
    updateBadge();
    syncStateToStorage();
  }
});

restoreStateFromStorage();
