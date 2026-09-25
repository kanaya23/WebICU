#!/usr/bin/env node
/**
 * query_session.js - Standalone, Zero-Dependency Session Inspector & Replay CLI
 * 
 * Part of Rolling-WebICU (https://github.com/lolbit)
 * Zero external dependencies. Uses only standard Node.js built-in modules (fs, path).
 * 
 * Usage:
 *   node query_session.js [options]
 *   node query_session.js --path /path/to/session [options]
 * 
 * Options:
 *   --summary (default)        Print session overview, stats, and action timeline
 *   --actions                  List all recorded user interactions & spawned containers
 *   --action <num> | -a <num>  Inspect a specific action and its spawned effects / items
 *   --comments                 Extract and format all comment threads and replies
 *   --dom                      Replay mutations and inspect the reconstructed virtual DOM
 *   --selector <cssSelector>   Filter DOM inspection by selector (used with --dom)
 *   --help | -h                Display this help screen
 */

const fs = require('fs');
const path = require('path');

// --- Argument Parsing ---
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    sessionPath: '.',
    mode: 'summary',
    actionIndex: null,
    requestId: null,
    searchQuery: null,
    selector: null,
    verbose: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--path' || arg === '-p') {
      options.sessionPath = args[++i];
    } else if (arg === '--summary') {
      options.mode = 'summary';
    } else if (arg === '--actions') {
      options.mode = 'actions';
    } else if (arg === '--action' || arg === '-a') {
      options.mode = 'action';
      options.actionIndex = parseInt(args[++i], 10);
    } else if (arg === '--network' || arg === '-n') {
      options.mode = 'network';
    } else if (arg === '--request' || arg === '-r') {
      options.mode = 'request';
      options.requestId = args[++i];
    } else if (arg === '--search-network' || arg === '--grep' || arg === '-g') {
      options.mode = 'search_network';
      options.searchQuery = args[++i];
    } else if (arg === '--comments') {
      options.mode = 'comments';
    } else if (arg === '--dom') {
      options.mode = 'dom';
    } else if (arg === '--selector' || arg === '-s') {
      options.selector = args[++i];
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith('-') && options.sessionPath === '.') {
      options.sessionPath = arg;
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Rolling-WebICU Session Query CLI (Zero-Dependency)

Usage:
  node query_session.js [options]
  node query_session.js --path <dir> [options]

Commands & Options:
  --summary (default)        Show session overview, URL, duration, and action table
  --actions                  List all user actions, captured form inputs & spawned UI
  --action <N>, -a <N>       Inspect Action #N in detail (form inputs, spawned items, API calls)
  --network, -n              List all captured HTTP fetch/XHR requests and causality
  --request <id>, -r <id>    Inspect full request headers, request body & response JSON
  --grep <query>, -g <query> Grep all network URLs, request/response headers, and bodies
  --comments                 Extract all expanded comments, authors, timestamps, and replies
  --dom                      Replay rrweb stream and inspect the reconstructed DOM tree
  --selector <sel>, -s <sel> Query specific CSS selector / attribute in reconstructed DOM
  --verbose, -v              Print additional debug details
  --help, -h                 Show this help screen
`);
}

// --- Data Loader ---
function loadSessionData(baseDir) {
  const resolved = path.resolve(baseDir);
  if (!fs.existsSync(resolved)) {
    console.error(`Error: Path does not exist: ${resolved}`);
    process.exit(1);
  }

  const manifestPath = path.join(resolved, 'manifest.json');
  const causalityPath = path.join(resolved, 'actions_and_causality.json');
  const timelinePath = path.join(resolved, 'activity_timeline.json');
  let rawEventsPath = path.join(resolved, 'raw_events.json');
  if (!fs.existsSync(rawEventsPath)) {
    rawEventsPath = path.join(resolved, 'raw_rrweb_events.json');
  }
  const snapshotsDir = path.join(resolved, 'snapshots');
  const netIndexPath = path.join(resolved, 'NetworkDump_FullCapture', 'network_index.json');
  const networkDumpDir = path.join(resolved, 'NetworkDump_FullCapture');

  const data = {
    dir: resolved,
    manifest: null,
    actions: [],
    network: [],
    networkDumpDir,
    timeline: [],
    rawEventsPath: null,
    snapshots: []
  };

  if (fs.existsSync(manifestPath)) {
    try { data.manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) {}
  }

  if (fs.existsSync(causalityPath)) {
    try { data.actions = JSON.parse(fs.readFileSync(causalityPath, 'utf8')); } catch (e) {}
  }

  if (fs.existsSync(netIndexPath)) {
    try { data.network = JSON.parse(fs.readFileSync(netIndexPath, 'utf8')); } catch (e) {}
  }

  if (fs.existsSync(timelinePath)) {
    try { data.timeline = JSON.parse(fs.readFileSync(timelinePath, 'utf8')); } catch (e) {}
  }

  if (fs.existsSync(rawEventsPath)) {
    data.rawEventsPath = rawEventsPath;

    // Fallback: If network_index.json is missing, reconstruct network from raw events
    if (data.network.length === 0) {
      try {
        const rawEvents = JSON.parse(fs.readFileSync(rawEventsPath, 'utf8'));
        const initialTs = rawEvents[0]?.timestamp || 0;
        let netIdx = 1;
        rawEvents.forEach(ev => {
          if (ev.type === 5 && ev.data?.tag === 'rolling-network') {
            const p = ev.data.payload || {};
            data.network.push({
              index: netIdx++,
              requestId: p.requestId || ('req_' + ev.timestamp),
              associatedActionId: p.associatedActionId || null,
              method: (p.method || 'GET').toUpperCase(),
              url: p.url || '',
              status: p.status !== undefined ? p.status : 200,
              statusText: p.statusText || '',
              durationMs: p.durationMs !== undefined ? p.durationMs : 0,
              relativeTimeMs: Math.max(0, (p.startTime || ev.timestamp) - initialTs),
              dumpFile: null,
              _inMemoryPayload: p
            });
          }
        });
      } catch (_) {}
    }

    // Fallback: If actions_and_causality.json is missing, reconstruct actions from raw events
    if (data.actions.length === 0) {
      try {
        const rawEvents = JSON.parse(fs.readFileSync(rawEventsPath, 'utf8'));
        const initialTs = rawEvents[0]?.timestamp || 0;
        rawEvents.forEach(ev => {
          if (ev.type === 5 && ev.data?.tag === 'rolling-action') {
            const p = ev.data.payload || {};
            data.actions.push({
              actionId: p.actionId || ('act_' + ev.timestamp),
              actionType: p.actionType || 'click',
              target: p.target || {},
              submitted_inputs: p.submitted_inputs || [],
              associated_effects: p.associated_effects || [],
              associated_network_requests: [],
              timestamp: ev.timestamp,
              relativeTimeMs: Math.max(0, ev.timestamp - initialTs)
            });
          }
        });
      } catch (_) {}
    }
  }

  // Cross-link network requests to actions if not already linked
  if (data.actions.length > 0 && data.network.length > 0) {
    data.actions.forEach(act => {
      if (!act.associated_network_requests || act.associated_network_requests.length === 0) {
        const linked = data.network.filter(r => r.associatedActionId === act.actionId);
        if (linked.length > 0) {
          act.associated_network_requests = linked;
        }
      }
    });
  }

  if (fs.existsSync(snapshotsDir)) {
    try {
      data.snapshots = fs.readdirSync(snapshotsDir).filter(f => f.endsWith('.html'));
    } catch (e) {}
  }

  return data;
}

function formatOffset(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const remMs = Math.floor((ms % 1000) / 10);
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(remMs).padStart(2, '0')}`;
}

// --- Lightweight In-Memory DOM Replayer ---
class VirtualDomReplayer {
  constructor(events) {
    this.events = events;
    this.nodeMap = new Map();
    this.initialTimestamp = events[0]?.timestamp || 0;
    this.replayedEventsCount = 0;
  }

  replayUpTo(targetTimestamp = Infinity) {
    this.nodeMap.clear();
    this.replayedEventsCount = 0;

    // 1. Initial Full Snapshot (type 2)
    const fullSnap = this.events.find(e => e.type === 2);
    if (fullSnap && fullSnap.data?.node) {
      this.indexNode(fullSnap.data.node);
    }

    // 2. Play incremental mutations up to targetTimestamp
    for (const e of this.events) {
      if (e.timestamp > targetTimestamp) break;
      this.replayedEventsCount++;

      if (e.type === 3 && e.data?.source === 0) { // IncrementalSnapshot Mutation
        const mut = e.data;
        if (mut.removes) {
          for (const r of mut.removes) {
            this.removeNode(r.id);
          }
        }
        if (mut.adds) {
          for (const add of mut.adds) {
            this.addNode(add.parentId, add.nextId, add.node);
          }
        }
        if (mut.texts) {
          for (const t of mut.texts) {
            const n = this.nodeMap.get(t.id);
            if (n) n.textContent = t.value;
          }
        }
        if (mut.attributes) {
          for (const a of mut.attributes) {
            const n = this.nodeMap.get(a.id);
            if (n) {
              if (!n.attributes) n.attributes = {};
              Object.assign(n.attributes, a.attributes);
            }
          }
        }
      }
    }
  }

  indexNode(node) {
    this.nodeMap.set(node.id, node);
    if (node.childNodes) {
      for (const child of node.childNodes) {
        this.indexNode(child);
      }
    }
  }

  addNode(parentId, nextId, node) {
    this.nodeMap.set(node.id, node);
    const parent = this.nodeMap.get(parentId);
    if (parent) {
      if (!parent.childNodes) parent.childNodes = [];
      if (nextId) {
        const idx = parent.childNodes.findIndex(c => c.id === nextId);
        if (idx >= 0) {
          parent.childNodes.splice(idx, 0, node);
          return;
        }
      }
      parent.childNodes.push(node);
    }
  }

  removeNode(id) {
    const node = this.nodeMap.get(id);
    if (node) {
      this.nodeMap.delete(id);
      if (node.childNodes) {
        for (const c of node.childNodes) {
          this.removeNode(c.id);
        }
      }
    }
  }

  getNodeText(node) {
    let texts = [];
    if (node.type === 3 && node.textContent) {
      const t = node.textContent.trim();
      if (t) texts.push(t);
    }
    if (node.childNodes) {
      for (const c of node.childNodes) {
        texts = texts.concat(this.getNodeText(c));
      }
    }
    return texts;
  }

  query(matcher) {
    const matches = [];
    for (const [id, node] of this.nodeMap.entries()) {
      if (matcher(node)) {
        matches.push(node);
      }
    }
    return matches;
  }
}

// --- Commands ---

function runSummary(data) {
  const m = data.manifest || {};
  console.log(`\n======================================================`);
  console.log(`  Rolling-WebICU Session Summary`);
  console.log(`======================================================`);
  console.log(`Session ID:      ${m.sessionId || 'N/A'}`);
  console.log(`Session Name:    ${m.sessionName || 'Untitled Session'}`);
  console.log(`Target URL:      ${m.targetUrl || 'N/A'}`);
  console.log(`Duration:        ${m.durationMs ? (m.durationMs / 1000).toFixed(1) + 's' : 'N/A'}`);
  console.log(`Resolution:      ${m.recordedResolution ? m.recordedResolution.width + 'x' + m.recordedResolution.height : 'Auto'}`);
  console.log(`Exported Date:   ${m.exportDate || 'N/A'}`);
  console.log(`Snapshots:       ${data.snapshots.length} progressive snapshots`);
  console.log(`Recorded Actions:${data.actions.length} user interactions`);
  console.log(`Network Requests:${data.network.length} HTTP fetch/XHR calls`);
  console.log(`------------------------------------------------------\n`);

  if (data.actions.length === 0) {
    console.log(`No semantic actions found in actions_and_causality.json.`);
    return;
  }

  console.log(`User Interaction Timeline:`);
  data.actions.forEach((act, idx) => {
    const offset = formatOffset(act.relativeTimeMs || 0);
    const targetTag = act.target?.tag || 'el';
    const targetText = (act.target?.text || '').substring(0, 45);
    const effects = act.associated_effects || [];
    const netReqs = act.associated_network_requests || [];
    const spawnedContainers = effects.filter(e => e.type === 'spawned_container');
    const containerSummary = spawnedContainers.map(c => c.summary || c.tag).join(', ');

    console.log(`  [Action #${idx + 1}] +${offset} | <${targetTag}> "${targetText}"`);
    const inputs = act.submitted_inputs || [];
    if (inputs.length > 0) {
      const inputSummary = inputs.map(i => `${i.name || i.id || i.type || 'field'}="${(i.value || '').substring(0, 30)}"`).join(', ');
      console.log(`      ↳ Form Input: ${inputSummary}`);
    }
    if (spawnedContainers.length > 0) {
      console.log(`      ↳ Spawned: ${containerSummary}`);
    }
    if (netReqs.length > 0) {
      console.log(`      ↳ Network: ${netReqs.length} triggered API request${netReqs.length > 1 ? 's' : ''}`);
    }
  });

  console.log(`\nTip: Run with --action <number> to inspect, or --network to list API calls.\n`);
}

function runActions(data) {
  console.log(`\n=== All Recorded Actions (${data.actions.length}) ===\n`);
  data.actions.forEach((act, idx) => {
    const offset = formatOffset(act.relativeTimeMs || 0);
    console.log(`------------------------------------------------------`);
    console.log(`Action #${idx + 1} (${act.actionType || 'click'}) @ +${offset}`);
    console.log(`Target:    <${act.target?.tag || 'unknown'}> role="${act.target?.role || ''}"`);
    console.log(`Text:      "${act.target?.text || ''}"`);
    console.log(`Selector:  ${act.target?.cssSelector || 'N/A'}`);
    console.log(`XPath:     ${act.target?.xpath || 'N/A'}`);
    console.log(`Coords:    (${act.target?.coords?.x || 0}, ${act.target?.coords?.y || 0})`);
    
    const inputs = act.submitted_inputs || [];
    if (inputs.length > 0) {
      console.log(`Inputs:    ${inputs.length} captured form field${inputs.length > 1 ? 's' : ''}`);
      inputs.forEach(inp => {
        const fieldName = inp.name || inp.id || inp.placeholder || inp.type || 'field';
        console.log(`  ↳ <${inp.tag}> ${fieldName}: "${inp.value}"`);
      });
    }

    const effects = act.associated_effects || [];
    console.log(`Effects:   ${effects.length} associated changes`);
    effects.forEach((eff, eIdx) => {
      console.log(`  Effect #${eIdx + 1}: [${eff.type}] ${eff.summary || ''}`);
      if (eff.spawned_content?.structured_items) {
        console.log(`    ↳ Contains ${eff.spawned_content.structured_items.length} structured items`);
      }
    });

    const netReqs = act.associated_network_requests || [];
    if (netReqs.length > 0) {
      console.log(`Network:   ${netReqs.length} associated API request${netReqs.length > 1 ? 's' : ''}`);
      netReqs.forEach(r => {
        console.log(`  ↳ [${r.status || 'OK'}] ${r.method} ${r.url} (${r.durationMs || 0}ms)`);
      });
    }
  });
  console.log(`------------------------------------------------------\n`);
}

function runActionDetail(data, targetIdx) {
  if (isNaN(targetIdx) || targetIdx < 1 || targetIdx > data.actions.length) {
    console.error(`Invalid action index: ${targetIdx}. Available actions: 1 to ${data.actions.length}`);
    process.exit(1);
  }

  const act = data.actions[targetIdx - 1];
  const offset = formatOffset(act.relativeTimeMs || 0);

  console.log(`\n======================================================`);
  console.log(`  Action #${targetIdx}: Detailed Inspection`);
  console.log(`======================================================`);
  console.log(`Type:       ${act.actionType || 'click'}`);
  console.log(`Offset:     +${offset} (${act.relativeTimeMs || 0}ms)`);
  console.log(`Target:     <${act.target?.tag || 'el'}> role="${act.target?.role || ''}"`);
  console.log(`Text:       "${act.target?.text || ''}"`);
  console.log(`Selector:   ${act.target?.cssSelector || 'N/A'}`);
  console.log(`Coords:     (${act.target?.coords?.x || 0}, ${act.target?.coords?.y || 0})`);
  console.log(`------------------------------------------------------`);

  // Captured Form Inputs
  const inputs = act.submitted_inputs || [];
  if (inputs.length > 0) {
    console.log(`\nCaptured Form Inputs (${inputs.length}):`);
    inputs.forEach((inp, idx) => {
      const fieldName = inp.name || inp.id || inp.placeholder || inp.type || 'field';
      console.log(`  ${idx + 1}. <${inp.tag}> ${fieldName}: "${inp.value}"`);
    });
  }

  // Associated Network API calls
  const netReqs = act.associated_network_requests || [];
  if (netReqs.length > 0) {
    console.log(`\nTriggered Network API Calls (${netReqs.length}):`);
    netReqs.forEach((r, idx) => {
      const statusStr = r.status ? `[${r.status}]` : '[ERR]';
      const durStr = r.durationMs !== undefined ? `${r.durationMs}ms` : '';
      console.log(`  ${idx + 1}. ${r.method} ${r.url} ${statusStr} ${durStr}`);
      if (r.dumpFile) {
        console.log(`     ↳ Lossless Dump: ${r.dumpFile}`);
      }
    });
  }

  const effects = act.associated_effects || [];
  console.log(`\nAssociated UI Effects (${effects.length}):`);

  let foundStructuredContent = false;

  effects.forEach((eff, i) => {
    console.log(`\n  [Effect #${i + 1}] Type: ${eff.type} (${eff.role || 'ui'})`);
    console.log(`  Summary:  ${eff.summary || ''}`);
    console.log(`  Selector: ${eff.selector || 'N/A'}`);

    // If new semantic content exists:
    if (eff.spawned_content) {
      foundStructuredContent = true;
      const sc = eff.spawned_content;
      if (sc.headings && sc.headings.length > 0) {
        console.log(`  Headings: ${sc.headings.join(' | ')}`);
      }
      if (sc.structured_items && sc.structured_items.length > 0) {
        console.log(`  Structured Items (${sc.structured_items.length}):`);
        sc.structured_items.forEach((item, itemIdx) => {
          const authorStr = item.author ? ` [Author: ${item.author}]` : '';
          const timeStr = item.time ? ` (${item.time})` : '';
          const reactStr = item.reactions ? ` [Reactions: ${item.reactions}]` : '';
          console.log(`    ${itemIdx + 1}.${authorStr}${timeStr}${reactStr} "${item.text}"`);
        });
      } else if (sc.text_preview && sc.text_preview.length > 0) {
        console.log(`  Text Preview:\n    ${sc.text_preview.join('\n    ')}`);
      }
    }
  });

  // Backward compatibility fallback: if legacy session with no spawned_content, reassemble rrweb DOM!
  if (!foundStructuredContent && data.rawEventsPath) {
    console.log(`\n[Info] Querying raw rrweb mutations for Action #${targetIdx}...`);
    try {
      const rawEvents = JSON.parse(fs.readFileSync(data.rawEventsPath, 'utf8'));
      const replayer = new VirtualDomReplayer(rawEvents);
      replayer.replayUpTo(act.timestamp + 1200);

      // Search for comment containers or spawned lists (excluding styles/scripts and editors)
      const commentNodes = replayer.query(n => {
        if (n.tagName === 'style' || n.tagName === 'script') return false;
        const testId = n.attributes?.['data-test-id'] || '';
        return (testId.includes('comment') && !testId.includes('editor')) || n.attributes?.role === 'listitem';
      });

      if (commentNodes.length > 0) {
        console.log(`Reconstructed ${commentNodes.length} comment/list elements from mutation timeline:`);
        const seenText = new Set();
        let displayCount = 0;
        commentNodes.forEach(cn => {
          const text = replayer.getNodeText(cn).join(' | ').trim();
          if (text && !text.includes('caret-color') && !text.includes('{') && !seenText.has(text) && displayCount < 15) {
            seenText.add(text);
            displayCount++;
            console.log(`  ${displayCount}. ${text}`);
          }
        });
      }
    } catch (e) {
      if (data.verbose) console.error(e);
    }
  }

  console.log(`\n`);
}

function runComments(data) {
  console.log(`\n======================================================`);
  console.log(`  Extracted Comments & Discussion Threads`);
  console.log(`======================================================\n`);

  let extractedComments = [];

  // 1. Try extracting from new causality spawned_content
  data.actions.forEach((act, actIdx) => {
    const effects = act.associated_effects || [];
    effects.forEach(eff => {
      if (eff.spawned_content?.structured_items) {
        eff.spawned_content.structured_items.forEach(item => {
          extractedComments.push({
            author: item.author || 'Anonymous',
            authorUrl: item.authorUrl,
            time: item.time || '',
            reactions: item.reactions || '',
            text: item.text,
            actionIndex: actIdx + 1
          });
        });
      }
    });
  });

  // 2. Fallback to rrweb mutation replay for legacy sessions
  if (extractedComments.length === 0 && data.rawEventsPath) {
    try {
      const rawEvents = JSON.parse(fs.readFileSync(data.rawEventsPath, 'utf8'));
      const replayer = new VirtualDomReplayer(rawEvents);
      // Replay all events
      replayer.replayUpTo(Infinity);

      const threads = replayer.query(n => n.attributes?.['data-test-id'] === 'commentThread-comment');

      threads.forEach((th, idx) => {
        const allTexts = replayer.getNodeText(th);
        
        // Find links for author (prefer link that has non-empty text name)
        const links = [];
        function findLinks(node) {
          if (node.tagName === 'a' && node.attributes?.href) {
            links.push({ href: node.attributes.href, text: replayer.getNodeText(node).join(' ').trim() });
          }
          if (node.childNodes) node.childNodes.forEach(findLinks);
        }
        findLinks(th);

        const namedLink = links.find(l => l.text && l.text.length > 0 && !l.text.includes('\n'));
        const primaryAuthor = namedLink ? namedLink.text : (links[0]?.text || 'Anonymous');
        const primaryUrl = namedLink ? namedLink.href : (links[0]?.href || '');

        // Extract time
        const timeMatch = allTexts.join(' ').match(/\b\d+\s*(?:hr|h|mgg|minggu|bulan|bln|hari|d|m|min|s|sec|detik|yr|thn|ago)\b/i);
        const timeStr = timeMatch ? timeMatch[0] : '';

        // Extract reactions / likes count (typically a solitary number like 1, 10)
        let reactions = '';
        allTexts.forEach(t => {
          if (/^\d+$/.test(t) && t !== '7' && t !== '14') {
            reactions = t;
          }
        });

        // Extract body text: exclude translation, reply, and author tokens
        const cleanTexts = allTexts.filter(t => !['Balas', 'Lihat terjemahan', 'Lihat', 'balasan', '⎯⎯', timeStr, reactions].includes(t));
        let bodyText = cleanTexts.join(' ');
        if (primaryAuthor && bodyText.startsWith(primaryAuthor)) {
          bodyText = bodyText.substring(primaryAuthor.length).trim();
        }

        extractedComments.push({
          author: primaryAuthor,
          authorUrl: primaryUrl,
          time: timeStr,
          reactions: reactions,
          text: bodyText.trim() || allTexts.join(' ')
        });
      });
    } catch (e) {
      if (data.verbose) console.error(e);
    }
  }

  if (extractedComments.length === 0) {
    console.log(`No comments detected in this session.`);
    return;
  }

  // Deduplicate and display
  const seen = new Set();
  let count = 0;
  extractedComments.forEach(c => {
    const key = c.author + '|' + c.text;
    if (seen.has(key)) return;
    seen.add(key);
    count++;

    console.log(`------------------------------------------------------`);
    console.log(`[#${count}] Author: ${c.author} ${c.authorUrl ? `(${c.authorUrl})` : ''}`);
    if (c.time) console.log(`    Time:   ${c.time}`);
    if (c.reactions) console.log(`    Likes:  ${c.reactions}`);
    console.log(`    Text:   "${c.text}"`);
  });
  console.log(`------------------------------------------------------\nTotal: ${count} unique comments recovered.\n`);
}

function runDomQuery(data, targetIdx, selector) {
  if (!data.rawEventsPath) {
    console.error(`raw_events.json / raw_rrweb_events.json not found in ${data.dir}`);
    process.exit(1);
  }

  const rawEvents = JSON.parse(fs.readFileSync(data.rawEventsPath, 'utf8'));
  const replayer = new VirtualDomReplayer(rawEvents);

  let targetTimestamp = Infinity;
  if (targetIdx) {
    const act = data.actions[targetIdx - 1];
    if (act) targetTimestamp = act.timestamp + 1000;
  }

  console.log(`Replaying DOM up to ${targetTimestamp === Infinity ? 'end of session' : 'Action #' + targetIdx}...`);
  replayer.replayUpTo(targetTimestamp);
  console.log(`Reconstructed virtual DOM: ${replayer.nodeMap.size} active nodes (processed ${replayer.replayedEventsCount} events).`);

  if (!selector) {
    console.log(`\nUse --selector <query> to search DOM. Examples:`);
    console.log(`  node query_session.js --dom --selector "aggregated-comment-list"`);
    console.log(`  node query_session.js --dom --selector "button"`);
    return;
  }

  console.log(`\nQuerying selector/keyword: "${selector}"...`);
  const queryLower = selector.toLowerCase();

  const results = replayer.query(n => {
    if (n.tagName && n.tagName.toLowerCase() === queryLower) return true;
    if (n.attributes) {
      for (const [k, v] of Object.entries(n.attributes)) {
        if (typeof v === 'string' && v.toLowerCase().includes(queryLower)) return true;
      }
    }
    return false;
  });

  console.log(`Found ${results.length} matching nodes:\n`);
  results.slice(0, 15).forEach((res, i) => {
    const tag = res.tagName || ('type_' + res.type);
    const attrs = res.attributes ? Object.entries(res.attributes).map(([k, v]) => `${k}="${v}"`).join(' ') : '';
    const text = replayer.getNodeText(res).join(' ').substring(0, 120);
    console.log(`[${i + 1}] <${tag} ${attrs}>`);
    if (text) console.log(`     Text: "${text}"`);
  });
  console.log(`\n`);
}

// --- Network Commands ---

function runNetwork(data) {
  console.log(`\n======================================================`);
  console.log(`  Captured Network Requests (${data.network.length})`);
  console.log(`======================================================\n`);

  if (data.network.length === 0) {
    console.log(`No HTTP requests captured in this session.`);
    return;
  }

  data.network.forEach((req, idx) => {
    const offset = formatOffset(req.relativeTimeMs || 0);
    const method = (req.method || 'GET').padEnd(6);
    const status = req.status ? String(req.status).padEnd(4) : 'ERR ';
    const duration = req.durationMs !== undefined ? `${req.durationMs}ms`.padStart(7) : '       ';
    const actBadge = req.associatedActionId ? ` [Action ${req.associatedActionId}]` : '';

    console.log(`[#${String(idx + 1).padStart(2)}] +${offset} | ${status} | ${method} | ${duration} | ${req.url}${actBadge}`);
  });

  console.log(`\nTip: Run with --request <number|id> to view full headers, payload, and response JSON.\n`);
}

function runRequestDetail(data, targetReq) {
  if (!targetReq) {
    console.error(`Please specify a request index or ID. Example: node query_session.js --request 1`);
    process.exit(1);
  }

  let req = null;
  const num = parseInt(targetReq, 10);
  if (!isNaN(num) && num >= 1 && num <= data.network.length) {
    req = data.network[num - 1];
  } else {
    req = data.network.find(r => r.requestId === targetReq || (r.dumpFile && r.dumpFile.includes(targetReq)));
  }

  if (!req) {
    console.error(`Request not found: ${targetReq}. Available: 1 to ${data.network.length}`);
    process.exit(1);
  }

  // Load lossless payload if dump file exists
  let fullPayload = req._inMemoryPayload || null;
  if (req.dumpFile) {
    const dumpPath = path.isAbsolute(req.dumpFile) ? req.dumpFile : path.join(data.dir, req.dumpFile);
    if (fs.existsSync(dumpPath)) {
      try {
        fullPayload = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
      } catch (e) {}
    }
  }

  const offset = formatOffset(req.relativeTimeMs || 0);

  console.log(`\n======================================================`);
  console.log(`  Request #${req.index || targetReq}: Full Lossless Inspection`);
  console.log(`======================================================`);
  console.log(`Request ID:    ${req.requestId}`);
  console.log(`Method:        ${req.method}`);
  console.log(`URL:           ${req.url}`);
  console.log(`Status:        ${req.status} ${req.statusText || ''}`);
  console.log(`Timing:        +${offset} (Duration: ${req.durationMs}ms)`);
  console.log(`Causality:     ${req.associatedActionId ? `Linked to ${req.associatedActionId}` : 'None (Autonomous/Background)'}`);
  if (req.dumpFile) console.log(`Dump File:     ${req.dumpFile}`);
  console.log(`------------------------------------------------------\n`);

  if (fullPayload) {
    console.log(`--- Request Headers ---`);
    console.log(JSON.stringify(fullPayload.requestHeaders || {}, null, 2));

    if (fullPayload.requestBody !== undefined && fullPayload.requestBody !== null) {
      console.log(`\n--- Request Body ---`);
      console.log(typeof fullPayload.requestBody === 'object' ? JSON.stringify(fullPayload.requestBody, null, 2) : fullPayload.requestBody);
    }

    console.log(`\n--- Response Headers ---`);
    console.log(JSON.stringify(fullPayload.responseHeaders || {}, null, 2));

    console.log(`\n--- Response Body ---`);
    if (fullPayload.responseBody !== undefined && fullPayload.responseBody !== null) {
      console.log(typeof fullPayload.responseBody === 'object' ? JSON.stringify(fullPayload.responseBody, null, 2) : fullPayload.responseBody);
    } else if (fullPayload.error) {
      console.log(`Error: ${fullPayload.error}`);
    } else {
      console.log(`(Empty response body)`);
    }
  } else {
    console.log(`(Full payload not available in this archive)`);
  }
  console.log(`\n`);
}

function runSearchNetwork(data, query) {
  if (!query) {
    console.error('Please specify a search query. Example: node query_session.js --grep "api/submit"');
    process.exit(1);
  }

  const needle = String(query).toLowerCase();
  console.log(`\n======================================================`);
  console.log(`  Network Search / Grep: "${query}"`);
  console.log(`======================================================\n`);

  if (data.network.length === 0) {
    console.log('No HTTP requests recorded in this session.');
    return;
  }

  let matchCount = 0;

  data.network.forEach((req, idx) => {
    let fullPayload = req._inMemoryPayload || null;
    if (req.dumpFile) {
      const dumpPath = path.isAbsolute(req.dumpFile) ? req.dumpFile : path.join(data.dir, req.dumpFile);
      if (fs.existsSync(dumpPath)) {
        try {
          fullPayload = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
        } catch (_) {}
      }
    }

    const matches = [];

    // 1. URL match
    if (req.url && req.url.toLowerCase().includes(needle)) {
      matches.push({ section: 'URL', text: req.url });
    }

    if (fullPayload) {
      // 2. Request Headers
      const reqHeadersStr = JSON.stringify(fullPayload.requestHeaders || {});
      if (reqHeadersStr.toLowerCase().includes(needle)) {
        matches.push({ section: 'Request Headers', text: reqHeadersStr });
      }

      // 3. Request Body
      if (fullPayload.requestBody !== undefined && fullPayload.requestBody !== null) {
        const bodyStr = typeof fullPayload.requestBody === 'object' 
          ? JSON.stringify(fullPayload.requestBody) 
          : String(fullPayload.requestBody);
        if (bodyStr.toLowerCase().includes(needle)) {
          matches.push({ section: 'Request Body', text: bodyStr });
        }
      }

      // 4. Response Headers
      const resHeadersStr = JSON.stringify(fullPayload.responseHeaders || {});
      if (resHeadersStr.toLowerCase().includes(needle)) {
        matches.push({ section: 'Response Headers', text: resHeadersStr });
      }

      // 5. Response Body
      if (fullPayload.responseBody !== undefined && fullPayload.responseBody !== null) {
        const resBodyStr = typeof fullPayload.responseBody === 'object'
          ? JSON.stringify(fullPayload.responseBody)
          : String(fullPayload.responseBody);
        if (resBodyStr.toLowerCase().includes(needle)) {
          matches.push({ section: 'Response Body', text: resBodyStr });
        }
      }
    }

    if (matches.length > 0) {
      matchCount++;
      const offset = formatOffset(req.relativeTimeMs || 0);
      const actBadge = req.associatedActionId ? ` [Action ${req.associatedActionId}]` : '';
      console.log(`[Request #${idx + 1}] ${req.method} ${req.status || 'OK'} (+${offset})${actBadge}`);
      console.log(`  URL: ${req.url}`);
      matches.forEach(m => {
        const lower = m.text.toLowerCase();
        const pos = lower.indexOf(needle);
        const start = Math.max(0, pos - 40);
        const end = Math.min(m.text.length, pos + needle.length + 80);
        const prefix = start > 0 ? '...' : '';
        const suffix = end < m.text.length ? '...' : '';
        const snippet = prefix + m.text.substring(start, end).replace(/\s+/g, ' ') + suffix;
        console.log(`  ↳ Match in [${m.section}]: ${snippet}`);
      });
      console.log(`  ↳ Lossless Dump: ${req.dumpFile || '(in memory)'}`);
      console.log(`------------------------------------------------------`);
    }
  });

  if (matchCount === 0) {
    console.log(`No network requests, headers, or payloads matched "${query}".`);
  } else {
    console.log(`\nFound ${matchCount} matching network request${matchCount > 1 ? 's' : ''}.\nTip: Run with --request <number> to inspect full details.`);
  }
}

// --- Main Execution ---
function main() {
  const options = parseArgs();
  const data = loadSessionData(options.sessionPath);

  switch (options.mode) {
    case 'actions':
      runActions(data);
      break;
    case 'action':
      runActionDetail(data, options.actionIndex);
      break;
    case 'network':
      runNetwork(data);
      break;
    case 'request':
      runRequestDetail(data, options.requestId);
      break;
    case 'search_network':
      runSearchNetwork(data, options.searchQuery);
      break;
    case 'comments':
      runComments(data);
      break;
    case 'dom':
      runDomQuery(data, options.actionIndex, options.selector);
      break;
    case 'summary':
    default:
      runSummary(data);
      break;
  }
}

if (require.main === module) {
  main();
}

module.exports = { VirtualDomReplayer, loadSessionData };
