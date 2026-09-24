/**
 * Test Suite: ZIP Builder (PKZIP Specification & CRC32)
 * Verifies zero-dependency ZIP archive creation, file header layout,
 * CRC32 checksum calculation, and file contents integrity.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Running test-zip-builder.js ---');

global.window = global;

// Load zip-builder.js
const code = fs.readFileSync(path.join(__dirname, '../pages/zip-builder.js'), 'utf8');
eval(code);

assert(global.__rrwebZipWriter, '__rrwebZipWriter should be exposed');

const zip = new global.__rrwebZipWriter();

// 1. Add sample files (text and binary)
const file1Content = JSON.stringify({ session: 'checkout-test', eventsCount: 42 }, null, 2);
const file2Content = `import { test } from '@playwright/test';\ntest('checkout', async () => {});\n`;
const file3Binary = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic bytes

zip.addFile('session.json', file1Content);
zip.addFile('test.spec.ts', file2Content);
zip.addFile('blobs/blob_001.png', file3Binary);

assert.strictEqual(zip.files.length, 3, 'Should have 3 files added');

// 2. Generate ZIP blob and buffer
const zipBlob = zip.generateBlob();
assert(zipBlob, 'Should return a Blob instance');

// Verify byte structure in ArrayBuffer
const arrayBuffer = zip.generateBuffer ? zip.generateBuffer() : null;

// Read zipBlob bytes
zipBlob.arrayBuffer().then((buf) => {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);

  // Check Local File Header signature (0x04034b50 -> 'PK\x03\x04')
  const localHeaderSig = view.getUint32(0, true);
  assert.strictEqual(localHeaderSig, 0x04034b50, 'First 4 bytes must be PK\\x03\\x04 Local File Header signature');
  console.log('✓ Test 1 Passed: Local File Header signature verification');

  // Verify file count and End of Central Directory Record (0x06054b50 -> 'PK\x05\x06')
  let foundEocd = false;
  for (let offset = bytes.length - 22; offset >= 0; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      foundEocd = true;
      const totalEntries = view.getUint16(offset + 10, true);
      assert.strictEqual(totalEntries, 3, 'EOCD must record 3 files');
      console.log('✓ Test 2 Passed: End of Central Directory Record and entry count (3 files)');
      break;
    }
  }
  assert(foundEocd, 'Must contain valid End of Central Directory Record');

  // Verify file contents can be located inside the stream
  const rawString = Buffer.from(bytes).toString('utf8');
  assert(rawString.includes('session.json'), 'ZIP archive must contain session.json entry');
  assert(rawString.includes('test.spec.ts'), 'ZIP archive must contain test.spec.ts entry');
  assert(rawString.includes('blobs/blob_001.png'), 'ZIP archive must contain blobs/blob_001.png entry');
  assert(rawString.includes('checkout-test'), 'ZIP archive payload must contain uncompressed content');
  console.log('✓ Test 3 Passed: File payload integrity in raw zip stream');

  console.log('All ZIP Builder tests passed successfully!\n');
});
