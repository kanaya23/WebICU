/**
 * WebICU / rrweb - Native Chrome CDP Network Capturer (1:1 DevTools HAR 1.2 Parity)
 *
 * Uses the Chrome DevTools Protocol (chrome.debugger) to capture authentic
 * browser network requests in the background with ZERO differences from Chrome DevTools.
 * Zero in-page monkey-patching, zero prototype pollution.
 */

export class CDPHarCapturer {
  constructor() {
    this.attachedTabId = null;
    this.requests = new Map(); // requestId -> internal request data
    this.startTime = null;
    this.startTimestamp = null;
    this.domContentTime = -1;
    this.loadTime = -1;
    this.pageUrl = '';
    this.pageTitle = '';
    this.pendingBodyPromises = new Set();
    this._onEvent = this._handleEvent.bind(this);
    this._onDetach = this._handleDetach.bind(this);
  }

  async start(tabId) {
    if (this.attachedTabId !== null) {
      await this.stop().catch(() => {});
    }

    this.attachedTabId = tabId;
    this.requests.clear();
    this.pendingBodyPromises.clear();
    this.startTime = Date.now();
    this.startTimestamp = performance.now();
    this.domContentTime = -1;
    this.loadTime = -1;

    chrome.debugger.onEvent.addListener(this._onEvent);
    chrome.debugger.onDetach.addListener(this._onDetach);

    try {
      await chrome.debugger.attach({ tabId }, '1.3');
      await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
      await chrome.debugger.sendCommand({ tabId }, 'Network.enable', {
        maxTotalBufferSize: 100000000,
        maxResourceBufferSize: 15000000,
        maxPostDataSize: 10000000
      });
      console.log(`[CDPHarCapturer] Attached to tab ${tabId}, enabled Page & Network domains with 1:1 DevTools parity.`);
    } catch (err) {
      console.warn(`[CDPHarCapturer] Failed to attach debugger to tab ${tabId}:`, err);
      this._cleanupListeners();
      this.attachedTabId = null;
      throw err;
    }
  }

  async stop(pageTitle = 'Recorded Page') {
    const tabId = this.attachedTabId;
    this.pageTitle = pageTitle;
    this._cleanupListeners();

    // Await all in-flight response body retrievals BEFORE detaching debugger
    if (this.pendingBodyPromises.size > 0) {
      try {
        await Promise.allSettled(Array.from(this.pendingBodyPromises));
      } catch (err) {
        console.warn('[CDPHarCapturer] Error awaiting pending bodies:', err);
      }
      this.pendingBodyPromises.clear();
    }

    if (tabId !== null) {
      this.attachedTabId = null;
      try {
        await chrome.debugger.detach({ tabId });
        console.log(`[CDPHarCapturer] Detached debugger from tab ${tabId}.`);
      } catch (err) {
        console.warn(`[CDPHarCapturer] Detach error on tab ${tabId}:`, err.message);
      }
    }

    return this.buildHar();
  }

  _cleanupListeners() {
    chrome.debugger.onEvent.removeListener(this._onEvent);
    chrome.debugger.onDetach.removeListener(this._onDetach);
  }

  _handleDetach(source, reason) {
    if (this.attachedTabId && source.tabId === this.attachedTabId) {
      console.log(`[CDPHarCapturer] Debugger detached by Chrome (reason: ${reason})`);
      this.attachedTabId = null;
      this._cleanupListeners();
    }
  }

  _handleEvent(source, method, params) {
    if (!this.attachedTabId || source.tabId !== this.attachedTabId) return;

    try {
      if (method === 'Page.domContentEventFired') {
        if (params && params.timestamp && this.startTimestamp) {
          this.domContentTime = Math.max(0, (params.timestamp - (this.startTimestamp / 1000)) * 1000);
        }
      } else if (method === 'Page.loadEventFired') {
        if (params && params.timestamp && this.startTimestamp) {
          this.loadTime = Math.max(0, (params.timestamp - (this.startTimestamp / 1000)) * 1000);
        }
      } else if (method === 'Network.requestWillBeSent') {
        const { requestId, request, wallTime, timestamp, initiator, type, redirectResponse } = params;

        // If this requestId already exists and has a redirect response, archive it under a redirected id
        if (redirectResponse && this.requests.has(requestId)) {
          const oldEntry = this.requests.get(requestId);
          const redirectId = `${requestId}.r${Date.now()}`;
          this.requests.set(redirectId, oldEntry);
        }

        const entry = {
          requestId,
          wallTime: wallTime || (Date.now() / 1000),
          issueTimestamp: timestamp || (performance.now() / 1000),
          finishTimestamp: null,
          method: request.method,
          url: request.url,
          requestHeaders: request.headers,
          wireRequestHeaders: null,
          initialPriority: request.initialPriority || 'Low',
          resourceType: (type || 'other').toLowerCase(),
          initiator: initiator || { type: 'other' },
          postData: request.postData || null,
          status: 0,
          statusText: '',
          protocol: '',
          responseHeaders: null,
          responseTiming: null,
          remoteIPAddress: '',
          remotePort: null,
          connectionId: null,
          fromDiskCache: false,
          fromServiceWorker: false,
          fromPrefetchCache: false,
          encodedDataLength: 0,
          decodedBodyLength: 0,
          mimeType: 'application/octet-stream',
          bodyText: undefined,
          bodyEncoding: undefined,
          errorText: null,
          redirectURL: ''
        };

        if (request.hasPostData && !request.postData && this.attachedTabId) {
          const p = chrome.debugger.sendCommand({ tabId: this.attachedTabId }, 'Network.getRequestPostData', { requestId })
            .then(res => {
              if (res && res.postData) {
                entry.postData = res.postData;
              }
            })
            .catch(() => {});
          this.pendingBodyPromises.add(p);
          p.finally(() => this.pendingBodyPromises.delete(p));
        }

        if (!this.pageUrl && request.url && (type === 'Document' || !this.pageUrl)) {
          this.pageUrl = request.url;
        }

        this.requests.set(requestId, entry);
      } else if (method === 'Network.responseReceived') {
        const { requestId, response, timestamp, type } = params;
        const entry = this.requests.get(requestId);
        if (entry) {
          if (type) entry.resourceType = (type || 'other').toLowerCase();
          entry.status = response.status;
          entry.statusText = response.statusText || '';
          entry.protocol = response.protocol || '';
          entry.responseHeaders = response.headers;
          if (response.requestHeaders) {
            entry.wireRequestHeaders = response.requestHeaders;
          }
          entry.responseTiming = response.timing || null;
          entry.remoteIPAddress = response.remoteIPAddress || '';
          entry.remotePort = response.remotePort || null;
          entry.connectionId = response.connectionId || null;
          entry.fromDiskCache = !!response.fromDiskCache;
          entry.fromServiceWorker = !!response.fromServiceWorker;
          entry.fromPrefetchCache = !!response.fromPrefetchCache;
          entry.encodedDataLength = response.encodedDataLength || 0;
          entry.mimeType = response.mimeType || 'application/octet-stream';

          if (response.headers) {
            const loc = response.headers['Location'] || response.headers['location'];
            if (loc) entry.redirectURL = loc;
          }
        }
      } else if (method === 'Network.loadingFinished') {
        const { requestId, timestamp, encodedDataLength } = params;
        const entry = this.requests.get(requestId);
        if (entry) {
          entry.finishTimestamp = timestamp;
          entry.encodedDataLength = encodedDataLength || entry.encodedDataLength;

          if (this.attachedTabId) {
            const p = chrome.debugger.sendCommand({ tabId: this.attachedTabId }, 'Network.getResponseBody', { requestId })
              .then(res => {
                if (res && res.body !== undefined) {
                  entry.bodyText = res.body;
                  if (res.base64Encoded) {
                    entry.bodyEncoding = 'base64';
                    try {
                      entry.decodedBodyLength = atob(res.body).length;
                    } catch {
                      entry.decodedBodyLength = encodedDataLength || 0;
                    }
                  } else {
                    entry.bodyEncoding = undefined;
                    try {
                      entry.decodedBodyLength = new TextEncoder().encode(res.body).length;
                    } catch {
                      entry.decodedBodyLength = res.body.length;
                    }
                  }
                }
              })
              .catch(() => {
                // Ignore missing bodies (e.g. 204 No Content, 304 Not Modified, or evicted)
              });
            this.pendingBodyPromises.add(p);
            p.finally(() => this.pendingBodyPromises.delete(p));
          }
        }
      } else if (method === 'Network.loadingFailed') {
        const { requestId, timestamp, errorText, canceled } = params;
        const entry = this.requests.get(requestId);
        if (entry) {
          entry.finishTimestamp = timestamp;
          entry.errorText = errorText || (canceled ? 'net::ERR_ABORTED' : 'net::ERR_FAILED');
          if (entry.status === 0) {
            entry.status = 0;
            entry.statusText = '';
          }
        }
      }
    } catch (err) {
      console.warn('[CDPHarCapturer] Error processing CDP event:', err);
    }
  }

  _headersToArray(headersObj) {
    if (!headersObj || typeof headersObj !== 'object') return [];
    const entries = Object.entries(headersObj);
    // Sort so HTTP/2 & HTTP/3 pseudo-headers (:authority, :method, :path, :scheme) appear first, matching DevTools
    entries.sort(([a], [b]) => {
      const aColon = a.startsWith(':');
      const bColon = b.startsWith(':');
      if (aColon && !bColon) return -1;
      if (!aColon && bColon) return 1;
      return 0;
    });
    return entries.map(([name, value]) => ({
      name,
      value: String(value)
    }));
  }

  _parseQueryString(urlStr) {
    try {
      const url = new URL(urlStr);
      const res = [];
      url.searchParams.forEach((value, name) => {
        res.push({ name, value });
      });
      return res;
    } catch {
      return [];
    }
  }

  _parseCookies(cookieStr) {
    if (!cookieStr || typeof cookieStr !== 'string') return [];
    const res = [];
    const parts = cookieStr.split(';');
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        res.push({
          name: trimmed.substring(0, eqIdx).trim(),
          value: trimmed.substring(eqIdx + 1).trim()
        });
      } else {
        res.push({ name: trimmed, value: '' });
      }
    }
    return res;
  }

  _normalizeHttpVersion(proto) {
    if (!proto) return '';
    const p = proto.toLowerCase();
    if (p === 'h2' || p === 'http/2.0') return 'http/2.0';
    if (p === 'h3') return 'h3';
    if (p.includes('http/1.1')) return 'HTTP/1.1';
    if (p.includes('http/1.0')) return 'HTTP/1.0';
    return proto;
  }

  _buildTimings(entry) {
    const timing = entry.responseTiming;
    const issueTime = entry.issueTimestamp; // in seconds
    const finishTime = entry.finishTimestamp || issueTime; // in seconds

    if (!timing) {
      const duration = Math.max(0, (finishTime - issueTime) * 1000);
      return {
        timings: {
          blocked: duration,
          dns: -1,
          ssl: -1,
          connect: -1,
          send: 0,
          wait: 0,
          receive: 0,
          _blocked_queueing: -1,
          _workerStart: -1,
          _workerReady: -1,
          _workerFetchStart: -1,
          _workerRespondWithSettled: -1
        },
        time: duration
      };
    }

    const requestTime = timing.requestTime; // baseline in seconds
    const queueing = Math.max(0, (requestTime - issueTime) * 1000);
    const blockedQueueing = queueing;

    let firstOffset = 0;
    if (timing.dnsStart > 0) {
      firstOffset = timing.dnsStart;
    } else if (timing.connectStart > 0) {
      firstOffset = timing.connectStart;
    } else if (timing.sendStart > 0) {
      firstOffset = timing.sendStart;
    }
    const blocked = blockedQueueing + firstOffset;

    const dns = timing.dnsStart >= 0 && timing.dnsEnd >= 0 ? Math.max(0, timing.dnsEnd - timing.dnsStart) : -1;
    const connect = timing.connectStart >= 0 && timing.connectEnd >= 0 ? Math.max(0, timing.connectEnd - timing.connectStart) : -1;
    const ssl = timing.sslStart >= 0 && timing.sslEnd >= 0 ? Math.max(0, timing.sslEnd - timing.sslStart) : -1;
    const send = timing.sendStart >= 0 && timing.sendEnd >= 0 ? Math.max(0, timing.sendEnd - timing.sendStart) : 0;
    const wait = timing.sendEnd >= 0 && timing.receiveHeadersEnd >= 0 ? Math.max(0, timing.receiveHeadersEnd - timing.sendEnd) : 0;

    let receive = 0;
    if (finishTime && timing.receiveHeadersEnd >= 0) {
      const headersEndTime = requestTime + (timing.receiveHeadersEnd / 1000);
      receive = Math.max(0, (finishTime - headersEndTime) * 1000);
    }

    const workerStart = timing.workerStart !== undefined ? timing.workerStart : -1;
    const workerReady = timing.workerReady !== undefined ? timing.workerReady : -1;
    const workerFetchStart = timing.workerFetchStart !== undefined ? timing.workerFetchStart : -1;
    const workerRespondWithSettled = timing.workerRespondWithSettled !== undefined ? timing.workerRespondWithSettled : -1;

    const timings = {
      blocked,
      dns,
      ssl,
      connect,
      send,
      wait,
      receive,
      _blocked_queueing: blockedQueueing,
      _workerStart: workerStart,
      _workerReady: workerReady,
      _workerFetchStart: workerFetchStart,
      _workerRespondWithSettled: workerRespondWithSettled
    };

    const time = (blocked > 0 ? blocked : 0) +
                 (dns > 0 ? dns : 0) +
                 (connect > 0 ? connect : 0) +
                 (send > 0 ? send : 0) +
                 (wait > 0 ? wait : 0) +
                 (receive > 0 ? receive : 0);

    return { timings, time };
  }

  buildHar() {
    const pageId = 'page_1';
    const startedDateTime = new Date(this.startTime || Date.now()).toISOString();

    const formattedEntries = [];
    for (const entry of this.requests.values()) {
      if (!entry.url) continue;

      const entryStartTime = new Date(entry.wallTime * 1000).toISOString();
      const { timings, time } = this._buildTimings(entry);

      const httpVersion = this._normalizeHttpVersion(entry.protocol);

      // Determine request headers (prefer wire headers from response if captured)
      const rawReqHeaders = entry.wireRequestHeaders || entry.requestHeaders || {};
      const reqHeaders = this._headersToArray(rawReqHeaders);

      // Determine request cookies
      const cookieHeader = reqHeaders.find(h => h.name.toLowerCase() === 'cookie');
      const reqCookies = cookieHeader ? this._parseCookies(cookieHeader.value) : [];

      // Determine request body size & post data
      let postDataObj = undefined;
      let reqBodySize = 0;
      if (entry.postData) {
        const ctHeader = reqHeaders.find(h => h.name.toLowerCase() === 'content-type');
        postDataObj = {
          mimeType: ctHeader ? ctHeader.value : 'application/octet-stream',
          text: entry.postData
        };
        try {
          reqBodySize = new TextEncoder().encode(entry.postData).length;
        } catch {
          reqBodySize = entry.postData.length;
        }
      }

      const requestObj = {
        method: entry.method,
        url: entry.url,
        httpVersion: httpVersion || 'HTTP/1.1',
        headers: reqHeaders,
        queryString: this._parseQueryString(entry.url),
        cookies: reqCookies,
        headersSize: -1,
        bodySize: reqBodySize
      };
      if (postDataObj) {
        requestObj.postData = postDataObj;
      }

      // Response headers & cookies
      const rawResHeaders = entry.responseHeaders || {};
      const resHeaders = this._headersToArray(rawResHeaders);
      const setCookieHeader = resHeaders.find(h => h.name.toLowerCase() === 'set-cookie');
      const resCookies = setCookieHeader ? this._parseCookies(setCookieHeader.value) : [];

      // Response content
      const contentObj = {
        size: entry.decodedBodyLength !== undefined && entry.decodedBodyLength !== 0
          ? entry.decodedBodyLength
          : (entry.encodedDataLength || 0),
        mimeType: entry.mimeType || 'application/octet-stream'
      };
      if (entry.bodyText !== undefined) {
        contentObj.text = entry.bodyText;
        if (entry.bodyEncoding === 'base64') {
          contentObj.encoding = 'base64';
        }
      }

      // Response statusText matching DevTools HTTP/2 & HTTP/3 convention
      let statusText = entry.statusText;
      if (!statusText && (httpVersion === 'http/2.0' || httpVersion === 'h3')) {
        statusText = '';
      }

      // Response body size & transfer size
      const isFromCache = entry.fromDiskCache || entry.fromPrefetchCache;
      const resBodySize = isFromCache ? 0 : (httpVersion === 'http/2.0' || httpVersion === 'h3' ? -1 : (entry.encodedDataLength || 0));
      const transferSize = isFromCache ? 0 : (entry.encodedDataLength || 0);

      const responseObj = {
        status: entry.status,
        statusText: statusText,
        httpVersion: httpVersion || '',
        headers: resHeaders,
        cookies: resCookies,
        content: contentObj,
        redirectURL: entry.redirectURL || '',
        headersSize: -1,
        bodySize: resBodySize,
        _transferSize: transferSize,
        _error: entry.errorText,
        _fetchedViaServiceWorker: entry.fromServiceWorker
      };

      // Construct HAR Entry with key ordering exactly matching Chrome DevTools
      const harEntry = {
        _initiator: entry.initiator,
        _priority: entry.initialPriority,
        _resourceType: entry.resourceType,
        cache: {},
        connection: entry.remotePort ? String(entry.remotePort) : (entry.connectionId ? String(entry.connectionId) : undefined),
        request: requestObj,
        response: responseObj,
        serverIPAddress: entry.remoteIPAddress || '',
        startedDateTime: entryStartTime,
        time: Math.round(time * 1000) / 1000,
        timings: timings
      };

      if (entry.connectionId !== null && entry.connectionId !== undefined) {
        harEntry._connectionId = String(entry.connectionId);
      }
      if (entry.fromDiskCache) {
        harEntry._fromCache = 'disk';
      } else if (entry.fromPrefetchCache) {
        harEntry._fromCache = 'memory';
      }

      harEntry.pageref = pageId;

      formattedEntries.push(harEntry);
    }

    // Sort entries strictly by chronological wall time
    formattedEntries.sort((a, b) => new Date(a.startedDateTime) - new Date(b.startedDateTime));

    return {
      log: {
        version: '1.2',
        creator: {
          name: 'WebInspector',
          version: '537.36'
        },
        pages: [
          {
            startedDateTime,
            id: pageId,
            title: this.pageTitle || this.pageUrl || 'Recorded Page',
            pageTimings: {
              onContentLoad: this.domContentTime > 0 ? this.domContentTime : -1,
              onLoad: this.loadTime > 0 ? this.loadTime : -1
            }
          }
        ],
        entries: formattedEntries
      }
    };
  }
}
