const fs = require('fs');

const f1Path = 'C:\\Users\\LOLBIT\\Downloads\\shopee.co.id.har_onpageload.txt';
const f2Path = 'C:\\Users\\LOLBIT\\Downloads\\Jual 2.4 TFT LCD Touchscreen spi serial Ili9341 240x320 pixel Arduino _ Shopee Indonesia.har';

function analyzeHar(filePath, label) {
  console.log(`\n=== Analyzing: ${label} ===`);
  const raw = fs.readFileSync(filePath, 'utf8');
  let har;
  try {
    har = JSON.parse(raw);
  } catch (e) {
    console.error(`Failed to parse JSON for ${label}:`, e.message);
    return null;
  }

  const log = har.log || {};
  const entries = log.entries || [];
  
  const stats = {
    label,
    harVersion: log.version,
    creator: log.creator,
    pagesCount: log.pages ? log.pages.length : 0,
    entriesCount: entries.length,
    methods: {},
    statusCodes: {},
    mimeTypes: {},
    entriesWithResponseBody: 0,
    totalResponseBodyBytes: 0,
    entriesWithPostData: 0,
    entriesWithCookies: 0,
    entriesWithTimingBreakdown: 0,
    entriesWithNegativeTimings: 0,
    entriesWithServerIp: 0,
    entriesWithInitiator: 0,
    sampleEntryFields: entries[0] ? Object.keys(entries[0]) : [],
    sampleRequestFields: entries[0]?.request ? Object.keys(entries[0].request) : [],
    sampleResponseFields: entries[0]?.response ? Object.keys(entries[0].response) : [],
    sampleTimingFields: entries[0]?.timings ? Object.keys(entries[0].timings) : [],
    sampleContentFields: entries[0]?.response?.content ? Object.keys(entries[0].response.content) : [],
    urlSamples: []
  };

  entries.forEach((e, idx) => {
    // Method
    const m = e.request?.method || 'UNKNOWN';
    stats.methods[m] = (stats.methods[m] || 0) + 1;

    // Status
    const s = e.response?.status ?? 'UNKNOWN';
    stats.statusCodes[s] = (stats.statusCodes[s] || 0) + 1;

    // MimeType
    const mime = (e.response?.content?.mimeType || 'unknown').split(';')[0].trim();
    stats.mimeTypes[mime] = (stats.mimeTypes[mime] || 0) + 1;

    // Response body
    if (e.response?.content?.text) {
      stats.entriesWithResponseBody++;
      stats.totalResponseBodyBytes += (e.response.content.text.length || 0);
    }

    // Post data
    if (e.request?.postData) {
      stats.entriesWithPostData++;
    }

    // Cookies
    if ((e.request?.cookies && e.request.cookies.length > 0) || (e.response?.cookies && e.response.cookies.length > 0)) {
      stats.entriesWithCookies++;
    }

    // Server IP
    if (e.serverIPAddress) {
      stats.entriesWithServerIp++;
    }

    // Initiator / custom fields
    if (e._initiator) {
      stats.entriesWithInitiator++;
    }

    // Timings
    const t = e.timings;
    if (t) {
      if (t.wait !== undefined && t.receive !== undefined) {
        stats.entriesWithTimingBreakdown++;
      }
      if (t.send < 0 || t.wait < 0 || t.receive < 0) {
        stats.entriesWithNegativeTimings++;
      }
    }

    if (idx < 5) {
      stats.urlSamples.push({
        url: e.request?.url?.substring(0, 100),
        status: e.response?.status,
        mimeType: e.response?.content?.mimeType,
        hasBody: !!e.response?.content?.text,
        bodyLen: e.response?.content?.text?.length || 0,
        timings: e.timings
      });
    }
  });

  return stats;
}

const s1 = analyzeHar(f1Path, 'DevTools Export (.txt)');
const s2 = analyzeHar(f2Path, 'WebICU Extension Export (.har)');

console.log('\n================ COMPARISON SUMMARY ================');
console.log(JSON.stringify({ s1, s2 }, null, 2));
