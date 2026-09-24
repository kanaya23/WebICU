const fs = require('fs');

const file = 'pages/index.js';
let code = fs.readFileSync(file, 'utf8');

const target = 'function up(){const e=k.useRef(null)';
const idx = code.indexOf(target);

if (idx === -1) {
  console.error('Target not found in pages/index.js');
  process.exit(1);
}

const replacement = `async function purgeAllData() {
  const t = await fn(), n = await kt();
  const r = t.transaction(Dt, 'readwrite'), i = n.transaction(Ze, 'readwrite');
  r.store.clear();
  i.store.clear();
  await Promise.all([r.done, i.done]);
}

export {
  ap as RRWebPlayer,
  Al as getSession,
  Dl as getSessionEvents,
  Qc as getAllSessions,
  Zc as deleteSessions,
  ef as exportSessionJson,
  exportHar as exportSessionHar,
  purgeAllData,
  kt as getSessionsDb,
  fn as getEventsDb
};
`;

code = code.slice(0, idx) + replacement;
fs.writeFileSync(file, code, 'utf8');
console.log('Successfully updated pages/index.js with clean Bauhaus exports!');
