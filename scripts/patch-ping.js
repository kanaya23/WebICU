const fs = require('fs');

const file = 'background/index.js';
let s = fs.readFileSync(file, 'utf8');
const target = 'o.provide("get-session-har"';

if (!s.includes('o.provide("ping"')) {
  s = s.replace(target, 'o.provide("ping", async () => ({ pong: true, timestamp: Date.now() })), ' + target);
  fs.writeFileSync(file, s, 'utf8');
  console.log('Ping service added to background/index.js');
} else {
  console.log('Ping service already present');
}
