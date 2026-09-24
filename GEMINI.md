# WebICU / rrweb Recorder Workspace Rules

## 1. Native Capabilities over In-Page Monkey-Patching
- When capturing network activity in Chrome extensions, NEVER inject scripts to monkey-patch `window.fetch`, `XMLHttpRequest`, or `navigator.sendBeacon`.
- Always use the browser's native protocol (`chrome.debugger` attached to `Network` and `Page` domains in the background service worker).
- Keep content scripts lightweight and isolated strictly to DOM recording (rrweb events).

## 2. Strict 1:1 DevTools HAR 1.2 Parity
When serializing Chrome CDP events to W3C HAR 1.2 format:
- **7-Phase Microsecond Timings**: Calculate `blocked`, `dns`, `ssl`, `connect`, `send`, `wait`, `receive`, and `_blocked_queueing` directly from `response.timing`. Total `time` MUST equal the exact mathematical sum of positive timing phases:
  $$\text{time} = \sum_{k \in \{\text{blocked}, \text{dns}, \text{connect}, \text{ssl}, \text{send}, \text{wait}, \text{receive}\}, v > 0} v$$
- **Binary Payloads (Images/Fonts)**: Binary assets MUST be retrieved via `Network.getResponseBody` and serialized with `encoding: "base64"` and exact decoded byte size.
- **Safe Teardown**: Always await all in-flight `Network.getResponseBody` and `Network.getRequestPostData` promises BEFORE detaching `chrome.debugger`.
- **Socket & Protocol Metadata**:
  - `serverIPAddress` from `response.remoteIPAddress`
  - `connection` from `response.remotePort` / `response.connectionId`
  - `_connectionId` from `response.connectionId`
  - `_priority` from `request.initialPriority`
  - `_resourceType` in lowercase (`fetch`, `xhr`, `script`, `image`, `stylesheet`, `font`, `document`)
  - `_transferSize` from `encodedDataLength`
  - `_error` as `null` (or specific network error string)
  - `_fetchedViaServiceWorker` as boolean
  - `creator` as `{ "name": "WebInspector", "version": "537.36" }`
  - `httpVersion` dynamically normalized (`http/2.0`, `h3`, `HTTP/1.1`)
  - Pseudo-headers (`:authority`, `:method`, `:path`, `:scheme`) sorted first in request headers

## 3. Real Live-Site Verification & Minimalist UI
- Always verify extension behavior, network recording, and replayers against real live sites (e.g. Wikipedia), never isolated synthetic mock pages that hide layout overflow or real-world multiplexing.
- Keep replayer UI clean, native, and uncluttered. Avoid intrusive overlays or bloated custom panels.
