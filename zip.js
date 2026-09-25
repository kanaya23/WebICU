// zip.js - Zero-Dependency Client-Side ZIP Archive Generator for Browser & Extensions
// Conforms to PKZIP 2.0 standard using native CompressionStream (deflate-raw)

export class ZipWriter {
  constructor() {
    this.files = [];
  }

  /**
   * Add a file to the ZIP archive
   * @param {string} filename - relative path inside ZIP (e.g. "snapshots/snapshot_001.html")
   * @param {string|Uint8Array|Blob} content - file data
   */
  async addFile(filename, content) {
    let data;
    if (typeof content === 'string') {
      data = new TextEncoder().encode(content);
    } else if (content instanceof Uint8Array) {
      data = content;
    } else if (content instanceof Blob) {
      const buffer = await content.arrayBuffer();
      data = new Uint8Array(buffer);
    } else {
      data = new TextEncoder().encode(JSON.stringify(content, null, 2));
    }

    // Attempt deflate-raw compression via browser CompressionStream if available
    let compressedData = null;
    let compressionMethod = 0; // 0 = stored (uncompressed)

    if (typeof CompressionStream !== 'undefined' && data.length > 32) {
      try {
        const cs = new CompressionStream('deflate-raw');
        const writer = cs.writable.getWriter();
        writer.write(data);
        writer.close();
        const reader = cs.readable.getReader();
        const chunks = [];
        let totalLen = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          totalLen += value.length;
        }
        compressedData = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of chunks) {
          compressedData.set(chunk, offset);
          offset += chunk.length;
        }
        if (compressedData.length < data.length) {
          compressionMethod = 8; // Deflate
        } else {
          compressedData = null;
        }
      } catch (e) {
        compressedData = null;
      }
    }

    const finalData = (compressionMethod === 8 && compressedData) ? compressedData : data;
    const crc = crc32(data);

    this.files.push({
      name: filename.replace(/\\/g, '/'),
      data: finalData,
      uncompressedSize: data.length,
      compressedSize: finalData.length,
      crc,
      compressionMethod,
      modTime: new Date()
    });
  }

  /**
   * Generate the final ZIP Blob
   * @returns {Blob}
   */
  generateZipBlob() {
    let localHeadersSize = 0;
    let centralDirSize = 0;

    for (const f of this.files) {
      const nameBytes = new TextEncoder().encode(f.name);
      f.nameBytes = nameBytes;
      localHeadersSize += 30 + nameBytes.length + f.compressedSize;
      centralDirSize += 46 + nameBytes.length;
    }

    const endOfCentralDirSize = 22;
    const totalSize = localHeadersSize + centralDirSize + endOfCentralDirSize;
    const buffer = new Uint8Array(totalSize);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    const centralOffsets = [];

    // 1. Write Local File Headers & Data
    for (const f of this.files) {
      centralOffsets.push(offset);

      // Local file header signature: 0x04034b50
      view.setUint32(offset, 0x04034b50, true);
      view.setUint16(offset + 4, 20, true); // Version needed to extract (2.0)
      view.setUint16(offset + 6, 0, true);  // General purpose bit flag
      view.setUint16(offset + 8, f.compressionMethod, true); // Compression method (0 or 8)

      const dosTime = toDosDateTime(f.modTime);
      view.setUint16(offset + 10, dosTime.time, true);
      view.setUint16(offset + 12, dosTime.date, true);

      view.setUint32(offset + 14, f.crc, true);
      view.setUint32(offset + 18, f.compressedSize, true);
      view.setUint32(offset + 22, f.uncompressedSize, true);
      view.setUint16(offset + 26, f.nameBytes.length, true);
      view.setUint16(offset + 28, 0, true); // Extra field length

      offset += 30;
      buffer.set(f.nameBytes, offset);
      offset += f.nameBytes.length;

      buffer.set(f.data, offset);
      offset += f.compressedSize;
    }

    const centralDirOffsetStart = offset;

    // 2. Write Central Directory Headers
    for (let i = 0; i < this.files.length; i++) {
      const f = this.files[i];
      const localOffset = centralOffsets[i];

      // Central file header signature: 0x02014b50
      view.setUint32(offset, 0x02014b50, true);
      view.setUint16(offset + 4, 20, true);  // Version made by (2.0)
      view.setUint16(offset + 6, 20, true);  // Version needed to extract
      view.setUint16(offset + 8, 0, true);   // General purpose bit flag
      view.setUint16(offset + 10, f.compressionMethod, true);

      const dosTime = toDosDateTime(f.modTime);
      view.setUint16(offset + 12, dosTime.time, true);
      view.setUint16(offset + 14, dosTime.date, true);

      view.setUint32(offset + 16, f.crc, true);
      view.setUint32(offset + 20, f.compressedSize, true);
      view.setUint32(offset + 24, f.uncompressedSize, true);
      view.setUint16(offset + 28, f.nameBytes.length, true);
      view.setUint16(offset + 30, 0, true);  // Extra field length
      view.setUint16(offset + 32, 0, true);  // Comment length
      view.setUint16(offset + 34, 0, true);  // Disk number start
      view.setUint16(offset + 36, 0, true);  // Internal file attributes
      view.setUint32(offset + 38, 0, true);  // External file attributes
      view.setUint32(offset + 42, localOffset, true); // Relative offset of local header

      offset += 46;
      buffer.set(f.nameBytes, offset);
      offset += f.nameBytes.length;
    }

    // 3. Write End of Central Directory Record (EOCD)
    // EOCD signature: 0x06054b50
    view.setUint32(offset, 0x06054b50, true);
    view.setUint16(offset + 4, 0, true); // Number of this disk
    view.setUint16(offset + 6, 0, true); // Disk where central directory starts
    view.setUint16(offset + 8, this.files.length, true); // Total entries on this disk
    view.setUint16(offset + 10, this.files.length, true); // Total entries
    view.setUint32(offset + 12, centralDirSize, true); // Size of central directory
    view.setUint32(offset + 16, centralDirOffsetStart, true); // Offset of start of central directory
    view.setUint16(offset + 20, 0, true); // ZIP comment length

    return new Blob([buffer], { type: 'application/zip' });
  }
}

// Standard CRC32 table calculation
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function toDosDateTime(d) {
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const seconds = Math.floor(d.getSeconds() / 2);

  const date = ((year - 1980) << 9) | (month << 5) | day;
  const time = (hours << 11) | (minutes << 5) | seconds;
  return { date, time };
}
