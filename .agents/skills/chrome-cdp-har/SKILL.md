---
name: chrome-cdp-har
description: >-
  Use this skill when implementing, maintaining, or debugging native Chrome DevTools Protocol (CDP)
  network capture in Chrome extensions or tools to generate 1:1 DevTools-parity W3C HAR 1.2 files.
---

# Native Chrome CDP HAR 1.2 Generation

This skill provides the architectural guidelines, CDP domain lifecycle, timing formulas, and serialization rules required to capture authentic browser network traffic with 1:1 DevTools parity.

---

## 1. Core Principles

1. **Zero Monkey-Patching**: Never override `fetch`, `XMLHttpRequest`, or `sendBeacon` in the target page context. In-page overrides corrupt page prototypes, miss service-worker requests, and fail on strict Content Security Policies.
2. **Native Background Interception**: Attach `chrome.debugger` to the target tab in the background service worker using protocol version `1.3`.
3. **1:1 DevTools Parity**: HAR logs produced by the extension must match Chrome DevTools' native export in schema, timing breakdown, binary body encoding, and metadata keys.

---

## 2. CDP Domain Initialization

Attach to the target tab and enable required domains with appropriate buffers:

```javascript
await chrome.debugger.attach({ tabId }, '1.3');
await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
await chrome.debugger.sendCommand({ tabId }, 'Network.enable', {
  maxTotalBufferSize: 100000000,   // 100 MB total buffer
  maxResourceBufferSize: 15000000, // 15 MB per resource
  maxPostDataSize: 10000000        // 10 MB post data
});
```

---

## 3. Event Lifecycle & Data Extraction

### `Network.requestWillBeSent`
- Record `wallTime` (seconds Unix epoch) for `startedDateTime`.
- Record `timestamp` (seconds monotonic) as `issueTimestamp`.
- Extract request method, URL, headers, and post data.
- If `request.hasPostData && !request.postData`, fetch asynchronously via `Network.getRequestPostData({ requestId })`.
- Record `initiator` object directly into `_initiator`.
- Record `initialPriority` into `_priority`.
- Record lowercase `type` into `_resourceType`.

### `Network.responseReceived`
- Extract `status`, `statusText`, `protocol`.
- Map wire `requestHeaders` (including `:authority`, `:method`, `:path`, `:scheme`) to request headers.
- Extract `response.timing` (`ResourceTiming` object).
- Extract `remoteIPAddress` (`serverIPAddress`), `remotePort` / `connectionId` (`connection` / `_connectionId`).
- Detect cache origin: `fromDiskCache` (`_fromCache: 'disk'`), `fromPrefetchCache` (`_fromCache: 'memory'`).

### `Network.loadingFinished`
- Record `finishTimestamp = timestamp`.
- Retrieve response body via `Network.getResponseBody({ requestId })`:
  - If `res.base64Encoded`: set `content.text = res.body`, `content.encoding = 'base64'`, `content.size = atob(res.body).length`.
  - If text: set `content.text = res.body`, `content.size = new TextEncoder().encode(res.body).length`.
  - Track in-flight promises in a `pendingBodyPromises` Set.

### `Network.loadingFailed`
- Record `errorText` (e.g. `'net::ERR_ABORTED'`, `'net::ERR_BLOCKED_BY_CLIENT'`) into `response._error`.
- Set `status: 0`, `statusText: ""`.

---

## 4. Exact 7-Phase Timing Calculations

Chromium's DevTools computes HAR timings from `response.timing` as follows:

```javascript
function buildTimings(entry) {
  const timing = entry.responseTiming;
  const issueTime = entry.issueTimestamp; // in seconds
  const finishTime = entry.finishTimestamp || issueTime;

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

  const timings = {
    blocked,
    dns,
    ssl,
    connect,
    send,
    wait,
    receive,
    _blocked_queueing: blockedQueueing,
    _workerStart: timing.workerStart !== undefined ? timing.workerStart : -1,
    _workerReady: timing.workerReady !== undefined ? timing.workerReady : -1,
    _workerFetchStart: timing.workerFetchStart !== undefined ? timing.workerFetchStart : -1,
    _workerRespondWithSettled: timing.workerRespondWithSettled !== undefined ? timing.workerRespondWithSettled : -1
  };

  // time MUST equal the mathematical sum of all positive non-underscore phases
  const time = (blocked > 0 ? blocked : 0) +
               (dns > 0 ? dns : 0) +
               (connect > 0 ? connect : 0) +
               (send > 0 ? send : 0) +
               (wait > 0 ? wait : 0) +
               (receive > 0 ? receive : 0);

  return { timings, time };
}
```

---

## 5. Safe Teardown Protocol

**CRITICAL**: Do NOT detach the debugger before all pending `Network.getResponseBody` calls settle. Detaching the debugger terminates active CDP commands and causes response bodies to be lost.

```javascript
async stop(pageTitle = 'Recorded Page') {
  const tabId = this.attachedTabId;
  this._cleanupListeners();

  // 1. Await all in-flight response body promises
  if (this.pendingBodyPromises.size > 0) {
    await Promise.allSettled(Array.from(this.pendingBodyPromises));
    this.pendingBodyPromises.clear();
  }

  // 2. Detach debugger
  if (tabId !== null) {
    this.attachedTabId = null;
    try {
      await chrome.debugger.detach({ tabId });
    } catch (err) {}
  }

  // 3. Serialize and return authentic HAR
  return this.buildHar();
}
```

---

## 6. Verification Against Real Sites

Never test exclusively against static local test sites. Verify HAR capture by:
1. Launching real Chromium using persistent user data context.
2. Navigating to complex live websites (e.g. Wikipedia).
3. Confirming that JSON APIs, scripts, stylesheets, and binary images (WebP/PNG) are all captured with exact timings and bodies.
4. Validating the generated HAR with automated schema assertions:
   ```javascript
   assert.strictEqual(har.log.creator.name, 'WebInspector');
   assert.strictEqual(har.log.creator.version, '537.36');
   assert.strictEqual(har.log.version, '1.2');
   assert(entry.serverIPAddress, 'Server IP must be present');
   assert(entry.timings.blocked >= 0, 'Blocked timing must be non-negative');
   ```
