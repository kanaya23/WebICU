const fs = require('fs');

const f1Path = 'C:\\Users\\LOLBIT\\Downloads\\shopee.co.id.har_onpageload.txt';
const f2Path = 'C:\\Users\\LOLBIT\\Downloads\\Jual 2.4 TFT LCD Touchscreen spi serial Ili9341 240x320 pixel Arduino _ Shopee Indonesia.har';

const har1 = JSON.parse(fs.readFileSync(f1Path, 'utf8'));
const har2 = JSON.parse(fs.readFileSync(f2Path, 'utf8'));

// Find exact matching URLs
const urls2 = new Set(har2.log.entries.map(e => e.request.url));
const commonUrls = har1.log.entries.filter(e => urls2.has(e.request.url)).map(e => e.request.url);

console.log('Total entries in S1:', har1.log.entries.length);
console.log('Total entries in S2:', har2.log.entries.length);
console.log('Common URLs found:', commonUrls.length);

// Pick 3 diverse common URLs: 1 API call (JSON), 1 JS file, 1 image
const sampleJsonUrl = commonUrls.find(u => u.includes('/api/') || u.includes('.json'));
const sampleJsUrl = commonUrls.find(u => u.endsWith('.js') || u.includes('.js?'));
const sampleImgUrl = commonUrls.find(u => u.includes('.webp') || u.includes('.png') || u.includes('.jpg'));

console.log('\nSelected Samples:');
console.log('JSON:', sampleJsonUrl);
console.log('JS:', sampleJsUrl);
console.log('IMG:', sampleImgUrl);

function printEntryDiff(label, url) {
  if (!url) return;
  console.log(`\n======================================================`);
  console.log(`DIFF FOR ${label}: ${url.substring(0, 100)}`);
  console.log(`======================================================`);

  const e1 = har1.log.entries.find(e => e.request.url === url);
  const e2 = har2.log.entries.find(e => e.request.url === url);

  const clean = (e) => {
    if (!e) return null;
    return {
      startedDateTime: e.startedDateTime,
      time: e.time,
      serverIPAddress: e.serverIPAddress,
      connection: e.connection,
      request: {
        method: e.request.method,
        httpVersion: e.request.httpVersion,
        headersCount: e.request.headers?.length,
        queryStringCount: e.request.queryString?.length,
        cookiesCount: e.request.cookies?.length,
        headersSize: e.request.headersSize,
        bodySize: e.request.bodySize,
        hasPostData: !!e.request.postData
      },
      response: {
        status: e.response.status,
        statusText: e.response.statusText,
        httpVersion: e.response.httpVersion,
        headersCount: e.response.headers?.length,
        cookiesCount: e.response.cookies?.length,
        content: {
          size: e.response.content?.size,
          mimeType: e.response.content?.mimeType,
          hasText: !!e.response.content?.text,
          textLen: e.response.content?.text?.length,
          encoding: e.response.content?.encoding
        },
        headersSize: e.response.headersSize,
        bodySize: e.response.bodySize,
        _transferSize: e.response._transferSize
      },
      timings: e.timings
    };
  };

  console.log('\n--- S1 (DevTools Console Export) ---');
  console.log(JSON.stringify(clean(e1), null, 2));

  console.log('\n--- S2 (Extension CDP Native Capturer) ---');
  console.log(JSON.stringify(clean(e2), null, 2));
}

printEntryDiff('JSON API Request', sampleJsonUrl);
printEntryDiff('JavaScript Asset', sampleJsUrl);
printEntryDiff('Image Asset', sampleImgUrl);
