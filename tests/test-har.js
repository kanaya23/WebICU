const path = require('path');
require('../pages/code-generator.js');

const mockEvents = [
  { type: 4, timestamp: 1000 },
  {
    type: 5,
    timestamp: 1200,
    data: {
      tag: 'network',
      payload: {
        method: 'POST',
        url: 'https://api.deepseek.com/chat/completions',
        status: 200,
        statusText: 'OK',
        requestHeaders: { 'content-type': 'application/json' },
        requestBody: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'hello' }] }),
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: JSON.stringify({ id: 'chat-123', choices: [{ message: { content: 'Hi there!' } }] }),
        startTime: 1200,
        endTime: 1285,
        duration: 85,
      },
    },
  },
  {
    type: 5,
    timestamp: 1400,
    data: {
      tag: 'network',
      payload: {
        method: 'GET',
        url: 'https://api.deepseek.com/query',
        status: 0,
        statusText: 'XHR Aborted',
        requestHeaders: {},
        requestBody: null,
        responseHeaders: {},
        responseBody: null,
        startTime: 1400,
        endTime: 1405,
        duration: 5,
        aborted: true,
      },
    },
  },
];

const harStr = global.__rrwebCodeGenerator.generateHar(mockEvents);
const har = JSON.parse(harStr);

console.log('HAR Valid Schema Version:', har.log.version === '1.2');
console.log('Total entries:', har.log.entries.length);
console.log('Entry 0 URL:', har.log.entries[0].request.url);
console.log('Entry 0 Status:', har.log.entries[0].response.status);
console.log('Entry 0 PostData MIME:', har.log.entries[0].request.postData.mimeType);
console.log('Entry 1 Status:', har.log.entries[1].response.status);
console.log('Entry 1 StatusText:', har.log.entries[1].response.statusText);

if (har.log.version === '1.2' && har.log.entries.length === 2 && har.log.entries[0].request.postData) {
  console.log('ALL HAR TESTS PASSED!');
  process.exit(0);
} else {
  console.error('HAR TEST FAILED!');
  process.exit(1);
}
