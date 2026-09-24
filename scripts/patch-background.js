const fs = require('fs');

const pristine = fs.readFileSync('C:\\Users\\LOLBIT\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Extensions\\pdaldeopoccdhlkabbkcjmecmmoninhe\\2.1.6_0\\background\\index.js', 'utf8');

let code = pristine;

// 1. Add import at top
code = 'import { CDPHarCapturer } from "./cdp-har-capturer.js";\n' + code;

// 2. Instantiate cdpCapturer
code = code.replace('const t=[],o=new le;', 'const t=[],o=new le,cdpCapturer=new CDPHarCapturer;');

// 3. Update getCurrentTabId
const oldTab = 'async getCurrentTabId(){return(await l.tabs.query({active:!0,currentWindow:!0}))[0].id||-1}';
const newTab = 'async getCurrentTabId(){const a=await l.tabs.query({active:!0,currentWindow:!0});const cur=a&&a[0];if(cur&&cur.url&&(cur.url.startsWith("http://")||cur.url.startsWith("https://")||cur.url.startsWith("file://")))return cur.id||-1;const b=await l.tabs.query({currentWindow:!0});const web=b&&b.find(t=>t&&t.url&&(t.url.startsWith("http://")||t.url.startsWith("https://")||t.url.startsWith("file://")));return web?web.id:(cur?cur.id:-1);}';
if (!code.includes(oldTab)) {
  console.error('oldTab not found');
  process.exit(1);
}
code = code.replace(oldTab, newTab);

// 4. Update StartButtonClicked
const oldStart = 'o.on(R.StartButtonClicked,async()=>{if(n.status!==d.IDLE)return;n={status:d.IDLE,activeTabId:-1},await l.storage.local.set({[h.recorderStatus]:n}),t.length=0;const g=await o.getCurrentTabId();if(g===-1)return;const u=await o.requestToTab(g,B.StartRecord,{}).catch(async S=>{n.errorMessage=S.message,await l.storage.local.set({[h.recorderStatus]:n})});u&&(Object.assign(n,{status:d.RECORDING,activeTabId:g,startTimestamp:u.startTimestamp}),await l.storage.local.set({[h.recorderStatus]:n}))})';
const newStart = 'o.on(R.StartButtonClicked,async()=>{if(n.status!==d.IDLE)return;n={status:d.IDLE,activeTabId:-1},await l.storage.local.set({[h.recorderStatus]:n}),t.length=0;const g=await o.getCurrentTabId();if(g===-1)return;const u=await o.requestToTab(g,B.StartRecord,{}).catch(async S=>{n.errorMessage=S.message,await l.storage.local.set({[h.recorderStatus]:n})});if(u){try{await cdpCapturer.start(g);}catch(e){console.warn("[Background] CDP start warning:",e);}Object.assign(n,{status:d.RECORDING,activeTabId:g,startTimestamp:u.startTimestamp}),await l.storage.local.set({[h.recorderStatus]:n});}})';
if (!code.includes(oldStart)) {
  console.error('oldStart not found');
  process.exit(1);
}
code = code.replace(oldStart, newStart);

// 5. Update StopButtonClicked to get recorded tab title and save session with HAR
const oldStop = 'o.on(R.StopButtonClicked,async()=>{if(n.status===d.IDLE)return;n.status===d.RECORDING&&await o.requestToTab(n.activeTabId,B.StopRecord,{}).catch(()=>({message:Q.RecordStopped,endTimestamp:Date.now()})),n={status:d.IDLE,activeTabId:-1},await l.storage.local.set({[h.recorderStatus]:n});const g=await l.tabs.query({active:!0,currentWindow:!0}).then(S=>{var C;return(C=S[0])==null?void 0:C.title}).catch(()=>{})??"new session",u=Ce(g);await Ee(u,t).catch(S=>{n.errorMessage=S.message,l.storage.local.set({[h.recorderStatus]:n})}),o.emit(R.SessionUpdated,{session:u}),t.length=0})';
const newStop = 'o.on(R.StopButtonClicked,async()=>{if(n.status===d.IDLE)return;const recTabId=n.activeTabId;let pageTitle="new session";try{if(recTabId!==-1){const tabInfo=await l.tabs.get(recTabId);if(tabInfo&&tabInfo.title){pageTitle=tabInfo.title;}}}catch(e){}if(pageTitle==="new session"){try{const act=await l.tabs.query({active:!0,currentWindow:!0});if(act[0]&&act[0].title&&!act[0].url?.startsWith("chrome-extension://")){pageTitle=act[0].title;}}catch(e){}}n.status===d.RECORDING&&await o.requestToTab(n.activeTabId,B.StopRecord,{}).catch(()=>({message:Q.RecordStopped,endTimestamp:Date.now()})),n={status:d.IDLE,activeTabId:-1},await l.storage.local.set({[h.recorderStatus]:n});let harData=null;try{harData=await cdpCapturer.stop(pageTitle);}catch(e){console.warn("[Background] CDP stop warning:",e);}const u=Ce(pageTitle);if(harData){u.har=harData;}await Ee(u,t).catch(S=>{n.errorMessage=S.message,l.storage.local.set({[h.recorderStatus]:n})}),o.emit(R.SessionUpdated,{session:u}),t.length=0})';
if (!code.includes(oldStop)) {
  console.error('oldStop not found');
  process.exit(1);
}
code = code.replace(oldStop, newStop);

// 6. Update f(g)
const oldF = 'async function f(g){if(n.status!==d.RECORDING||n.activeTabId===-1)return;const u=await o.requestToTab(n.activeTabId,B.StopRecord,{}).catch(()=>{});Object.assign(n,{status:g,activeTabId:-1,pausedTimestamp:u==null?void 0:u.endTimestamp}),await l.storage.local.set({[h.recorderStatus]:n})}';
const newF = 'async function f(g){if(n.status!==d.RECORDING||n.activeTabId===-1)return;try{await cdpCapturer.stop();}catch(e){}const u=await o.requestToTab(n.activeTabId,B.StopRecord,{}).catch(()=>{});Object.assign(n,{status:g,activeTabId:-1,pausedTimestamp:u==null?void 0:u.endTimestamp}),await l.storage.local.set({[h.recorderStatus]:n})}';
if (!code.includes(oldF)) {
  console.error('oldF not found');
  process.exit(1);
}
code = code.replace(oldF, newF);

// 7. Update p(g)
const oldP = 'n={status:d.RECORDING,activeTabId:g,startTimestamp:(u||Date.now())+C},await l.storage.local.set({[h.recorderStatus]:n})}';
const newP = 'try{await cdpCapturer.start(g);}catch(e){}n={status:d.RECORDING,activeTabId:g,startTimestamp:(u||Date.now())+C},await l.storage.local.set({[h.recorderStatus]:n})}';
if (!code.includes(oldP)) {
  console.error('oldP not found');
  process.exit(1);
}
code = code.replace(oldP, newP);

// 8. Service for get-session-har
const serviceAnchor = 'o.on(R.ContentScriptEmitEvent,g=>{t.push(g)}),';
const serviceAdd = 'o.provide("get-session-har",async({sessionId})=>{try{const db=await Te();const s=await db.get(V,sessionId);return s&&s.har?s.har:null;}catch(e){return null;}}),';
if (!code.includes('get-session-har')) {
  code = code.replace(serviceAnchor, serviceAdd + serviceAnchor);
}

fs.writeFileSync('background/index.js', code, 'utf8');
console.log('background/index.js updated with title preservation and HAR saving!');
