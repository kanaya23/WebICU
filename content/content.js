// content.js - Content script running in isolated world
(() => {
  // Never run in sub-frames or embedded widgets
  if (window !== window.top) return;

  if (window.__webicu_content_script_active) return;
  window.__webicu_content_script_active = true;

  let isRecording = false;
  let streamPort = null;
  let eventBuffer = [];
  let flushTimer = null;
  let scriptsInjected = false;

  function ensurePort() {
    if (streamPort) return streamPort;
    try {
      streamPort = chrome.runtime.connect({ name: 'webicu-stream' });
      streamPort.onDisconnect.addListener(() => {
        streamPort = null;
      });
    } catch (e) {
      console.warn('[WebICU] Port connection failed:', e);
      streamPort = null;
    }
    return streamPort;
  }

  function flushEvents() {
    if (eventBuffer.length === 0) return;
    const batch = eventBuffer.slice();
    eventBuffer = [];
    const port = ensurePort();
    if (port) {
      port.postMessage({ type: 'EVENTS_BATCH', events: batch });
    } else {
      // Fallback to runtime.sendMessage
      chrome.runtime.sendMessage({ type: 'EVENTS_BATCH', events: batch }).catch(() => {});
    }
  }

  function queueEvent(event) {
    eventBuffer.push(event);
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushEvents();
      }, 50);
    }
    if (eventBuffer.length >= 25) {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      flushEvents();
    }
  }

  function injectScripts() {
    if (scriptsInjected) return Promise.resolve();

    return new Promise((resolve) => {
      let resolved = false;

      function onReady(event) {
        if (event.data?.source === 'webicu-page-inject' && (event.data?.action === 'WEBICU_INJECT_READY' || event.data?.action === 'WEBICU_STARTED')) {
          if (!resolved) {
            resolved = true;
            scriptsInjected = true;
            window.removeEventListener('message', onReady);
            resolve();
          }
        }
      }
      window.addEventListener('message', onReady);

      // Ping to check if background script already injected into MAIN world via chrome.scripting.executeScript
      window.postMessage({ source: 'webicu-content-script', action: 'WEBICU_CMD_PING' }, '*');

      // Fallback: If not ready within 120ms, attempt DOM script injection
      setTimeout(() => {
        if (resolved) return;
        try {
          const rrwebScript = document.createElement('script');
          rrwebScript.id = 'webicu-lib-script';
          rrwebScript.src = chrome.runtime.getURL('vendor/rrweb.umd.js');

          rrwebScript.onload = () => {
            const runnerScript = document.createElement('script');
            runnerScript.id = 'webicu-runner-script';
            runnerScript.src = chrome.runtime.getURL('content/inject.js');
            runnerScript.onload = () => {
              if (!resolved) {
                resolved = true;
                scriptsInjected = true;
                resolve();
              }
            };
            runnerScript.onerror = () => {
              if (!resolved) { resolved = true; resolve(); }
            };
            (document.head || document.documentElement).appendChild(runnerScript);
          };
          rrwebScript.onerror = () => {
            if (!resolved) { resolved = true; resolve(); }
          };

          (document.head || document.documentElement).appendChild(rrwebScript);
        } catch (_) {
          if (!resolved) { resolved = true; resolve(); }
        }
      }, 120);
    });
  }

  function startRecording(config = {}) {
    ensurePort();
    injectScripts().then(() => {
      window.postMessage({
        source: 'webicu-content-script',
        action: 'WEBICU_CMD_START',
        config
      }, '*');
      isRecording = true;
    });
  }

  function stopRecording() {
    if (!isRecording) return;
    window.postMessage({
      source: 'webicu-content-script',
      action: 'WEBICU_CMD_STOP'
    }, '*');
    isRecording = false;
    flushEvents();
  }

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
    try {
      const response = await chrome.runtime.sendMessage({ type: 'FETCH_STYLESHEET', url });
      if (response && response.success && response.cssText) {
        stylesheetCache.set(url, response.cssText);
        return response.cssText;
      }
    } catch (e) {}

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

      // Strip CSP meta tags so inlined styles/fonts aren't blocked offline
      doc.querySelectorAll('meta[http-equiv="Content-Security-Policy" i], meta[http-equiv="content-security-policy" i]').forEach(m => m.remove());

      // Ensure <meta name="referrer" content="no-referrer">
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
            const fullUrl = new URL(href, baseUrl || window.location.href).href;
            const rawCss = await fetchStylesheetText(fullUrl);
            if (rawCss) {
              const rebasedCss = rebaseCssUrls(rawCss, fullUrl);
              const styleEl = doc.createElement('style');
              styleEl.setAttribute('data-inlined-href', fullUrl);
              styleEl.textContent = rebasedCss;
              link.replaceWith(styleEl);
            }
          } catch (e) {}
        }));
      }
      return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
    } catch (e) {
      return html;
    }
  }

  // Listen to messages from inject.js (page context)
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || (event.data.source !== 'webicu-page-inject' && event.data.source !== 'rrweb-page-inject')) {
      return;
    }

    const { action, event: webicuEvent } = event.data;

    if ((action === 'WEBICU_EVENT' || action === 'RRWEB_EVENT') && webicuEvent) {
      if (webicuEvent.type === 5 && webicuEvent.data?.tag === 'rolling-snapshot' && webicuEvent.data?.payload?.html) {
        inlineSnapshotExternalStyles(webicuEvent.data.payload.html, webicuEvent.data.payload.url)
          .then((inlinedHtml) => {
            webicuEvent.data.payload.html = inlinedHtml;
            queueEvent(webicuEvent);
          })
          .catch(() => {
            queueEvent(webicuEvent);
          });
      } else {
        queueEvent(webicuEvent);
      }
    } else if (action === 'WEBICU_STARTED' || action === 'RRWEB_STARTED') {
      isRecording = true;
      const port = ensurePort();
      if (port) port.postMessage({ type: 'RECORDING_ACTIVE' });
    } else if (action === 'WEBICU_STOPPED' || action === 'RRWEB_STOPPED') {
      isRecording = false;
      flushEvents();
      const port = ensurePort();
      if (port) port.postMessage({ type: 'RECORDING_STOPPED' });
    }
  });

  // Listen to messages from background/popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return;

    switch (message.type) {
      case 'START_RECORD':
        startRecording(message.config);
        sendResponse({ success: true, isRecording: true });
        break;

      case 'STOP_RECORD':
        stopRecording();
        sendResponse({ success: true, isRecording: false });
        break;

      case 'GET_PAGE_STATUS':
        sendResponse({
          isRecording,
          url: window.location.href,
          title: document.title
        });
        break;
    }
    return true;
  });

  // On page load, check if background is recording this tab
  chrome.runtime.sendMessage({ type: 'QUERY_TAB_RECORDING' }, (res) => {
    if (chrome.runtime.lastError) return;
    if (res && res.shouldRecord) {
      startRecording(res.config);
    }
  });
})();
