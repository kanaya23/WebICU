================================================================================
                    WELCOME. Exported from WebICU.
================================================================================

Greetings! Whether you are a human developer, a data scientist, a reverse
engineer, a robot(we're not racist to robot promise!), or a cat parsing this archive:

You are now a surgeon, that's all. Bye.

================================================================================
                                  HOW TO PLAY
================================================================================

--------------------------------------------------------------------------------
METHOD 1: Instant Analysis with the Zero-Dependency CLI (Recommended)
--------------------------------------------------------------------------------
This archive includes `query_session.js` — a standalone inspection tool requiring
only standard Node.js.

Open your terminal in this directory and run:

  $ node query_session.js --summary
    -> Prints session overview: URL, start time, duration, and user interaction table.

  $ node query_session.js --actions
    -> Lists every user interaction (clicks, inputs, submissions) alongside
       spawned DOM containers and associated API calls.

  $ node query_session.js --action <number>
    -> Deep-dive into a specific action: form inputs, extracted text, and DOM mutations.

  $ node query_session.js --network
    -> Lists all intercepted HTTP fetch/XHR requests with status, timing, and endpoints.

  $ node query_session.js --request <requestId>
    -> Prints the full request headers, request payload, response headers, and response body.

  $ node query_session.js --grep "<query>"
    -> Searches URLs, request headers, request bodies, and response payloads for keywords.

  $ node query_session.js --comments
    -> Extracts structured discussion threads, user reviews, or comments revealed during the session.

  $ node query_session.js --dom
    -> Reconstructs the complete virtual DOM tree at the end of the session.

  $ node query_session.js --dom --selector "your-css-selector"
    -> Evaluates CSS selectors against the reconstructed DOM to test scraping targets.

--------------------------------------------------------------------------------
METHOD 2: Visual Inspection via Standalone HTML Snapshots
--------------------------------------------------------------------------------
Navigate into the `snapshots/` folder:
  - Open any `.html` file directly in Google Chrome, Brave, Firefox, or Safari.
  - Snapshots are 100% self-contained and offline-ready.
  - All external stylesheets, web fonts, and CSS-in-JS rules are embedded.
  - Open DevTools (F12) to inspect element classes, IDs, attributes, and DOM hierarchies
    without needing a local web server.

--------------------------------------------------------------------------------
METHOD 3: Interactive Replay in the WebICU Dashboard -Hoomans only!!!!!
--------------------------------------------------------------------------------
Replay the entire session visually with timeline scrubbing:
  1. Open your browser with the WebICU extension installed.
  2. Click the extension icon and select "Studio Dashboard".
  3. Drag and drop this ZIP file (or `raw_events.json`) into the dashboard.
  4. Watch the exact mouse movements, clicks, scrolling, and DOM mutations unfold
     in real time or at up to 8x playback speed.

================================================================================
               HOW TO WORK WITH THE CAPTURED DATA (IN-DEPTH)
================================================================================

This directory is organized into 5 structured intelligence layers:

[1] manifest.json
    ----------------------------------------------------------------------------
    High-level metadata describing the recorded environment:
    * sessionId           : Unique identifier for this capture session.
    * sessionName         : Tab title or user-assigned label.
    * targetUrl           : Initial URL where recording began.
    * recordedTimestamp   : Epoch timestamp (ms) when recording started.
    * durationMs          : Total active duration of the session in milliseconds.
    * totalEventsCount    : Number of raw rrweb mutation events recorded.
    * captureEngine       : 'STEALTH_MV3' (silent, undetectable) or 'CDP_DEBUGGER'.
    * recordedResolution  : Native viewport width and height of the recorded tab.

[2] NetworkDump_FullCapture/
    ----------------------------------------------------------------------------
    Lossless audit log of all network activity intercepted during the session:
    * network_index.json  : Quick reference table mapping every request index to its
                            HTTP method, URL, status code, timing, and dump file.
    * req_*.json          : Individual lossless dump files containing:
                            - Exact request URL & query parameters
                            - Request headers & parsed request body (JSON / FormData / Text)
                            - Response headers & parsed response body (JSON / Text)
                            - `associatedActionId`: The causality link binding this
                              network request to the user action that triggered it!

[3] actions_and_causality.json
    ----------------------------------------------------------------------------
    Chronological record of user intent and resulting page state changes:
    * type                : 'CLICK', 'INPUT', 'SUBMIT', 'NAVIGATION', 'HOTKEY'
    * target              : Tag name, element ID, classes, readable text, and XPath.
    * form_inputs         : Values captured from inputs/textareas preceding the action.
    * associated_network_requests : Pointers to the exact network calls initiated by this action.
    * spawned_containers  : DOM subtrees (modals, popups, dropdown items) that appeared
                            as a direct result of this action.

[4] snapshots/
    ----------------------------------------------------------------------------
    Offline HTML keyframes captured at critical workflow junctures:
    * snapshot_001_initial_load.html  : Baseline DOM state upon page readiness.
    * snapshot_*_spa_push_state.html  : DOM states after client-side SPA routing.
    * snapshot_*_ui_expanded.html     : DOM states captured after expanding hidden content.
    * snapshot_*_manual_hotkey.html   : Explicit snapshots triggered via Ctrl+Shift+S.

[5] raw_events.json & activity_timeline.json
    ----------------------------------------------------------------------------
    * raw_events.json         : The complete, millisecond-accurate event stream (raw_rrweb_events.json).
                                Compatible with standard rrweb players and custom replay pipelines.
    * activity_timeline.json  : Simplified human-readable event log for rapid auditing.

================================================================================
                    WebICU - I see you in ICU.
================================================================================
