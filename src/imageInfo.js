import { readFile } from 'node:fs/promises';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RIFF_SIGNATURE = Buffer.from('RIFF', 'ascii');
const WEBP_SIGNATURE = Buffer.from('WEBP', 'ascii');
const GIF87A_SIGNATURE = Buffer.from('GIF87a', 'ascii');
const GIF89A_SIGNATURE = Buffer.from('GIF89a', 'ascii');

function isPng(buffer) {
  if (!Buffer.isBuffer(buffer)) return false;
  if (buffer.length < PNG_SIGNATURE.length) return false;
  return buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

function isJpeg(buffer) {
  if (!Buffer.isBuffer(buffer)) return false;
  if (buffer.length < 4) return false;
  return buffer[0] === 0xff && buffer[1] === 0xd8;
}

function isWebp(buffer) {
  if (!Buffer.isBuffer(buffer)) return false;
  if (buffer.length < 16) return false;
  if (!buffer.subarray(0, 4).equals(RIFF_SIGNATURE)) return false;
  return buffer.subarray(8, 12).equals(WEBP_SIGNATURE);
}

function isGif(buffer) {
  if (!Buffer.isBuffer(buffer)) return false;
  if (buffer.length < 10) return false;
  const header = buffer.subarray(0, 6);
  return header.equals(GIF87A_SIGNATURE) || header.equals(GIF89A_SIGNATURE);
}

function readGifDimensions(buffer) {
  // GIF header: 6 bytes ("GIF87a"/"GIF89a")
  // Logical Screen Descriptor: width (2 LE) + height (2 LE) + packed + bg + aspect
  if (buffer.length < 10) return null;
  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function readPngIhdr(buffer) {
  // PNG format:
  // - 8 byte signature
  // - chunk: length (4), type (4), data (length), crc (4)
  //
  // IHDR is required and must be the first chunk.
  const minLen = 8 + 4 + 4 + 13 + 4;
  if (buffer.length < minLen) return null;

  const length = buffer.readUInt32BE(8);
  const type = buffer.subarray(12, 16).toString('ascii');
  if (type !== 'IHDR') return null;
  if (length !== 13) return null;

  const dataOffset = 16;
  if (buffer.length < dataOffset + length) return null;
  const width = buffer.readUInt32BE(dataOffset);
  const height = buffer.readUInt32BE(dataOffset + 4);

  // Basic sanity. PNG width/height are 32-bit unsigned, but 0 is invalid.
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;

  return { width, height };
}

function readJpegSof(buffer) {
  // JPEG markers:
  // - SOI: FF D8
  // - segments: FF <marker> <length:2> <payload:length-2>
  // Dimensions live in SOF0/SOF2/etc: payload contains precision, height, width.
  let offset = 2;

  const readMarker = () => {
    while (offset < buffer.length && buffer[offset] !== 0xff) offset += 1;
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) return null;
    const marker = buffer[offset];
    offset += 1;
    return marker;
  };

  while (offset < buffer.length) {
    const marker = readMarker();
    if (marker == null) return null;
    if (marker === 0xd9) return null; // EOI
    if (marker === 0xda) return null; // SOS (image data begins)
    if (marker >= 0xd0 && marker <= 0xd7) continue; // restart markers
    if (marker === 0x01) continue; // TEM

    if (offset + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    offset += 2;
    if (length < 2) return null;
    const segmentStart = offset;
    const segmentEnd = offset + (length - 2);
    if (segmentEnd > buffer.length) return null;

    const isSof =
      (marker >= 0xc0 && marker <= 0xcf) &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      if (segmentStart + 5 > segmentEnd) return null;
      const height = buffer.readUInt16BE(segmentStart + 1);
      const width = buffer.readUInt16BE(segmentStart + 3);
      if (width <= 0 || height <= 0) return null;
      return { width, height };
    }

    offset = segmentEnd;
  }

  return null;
}

function readWebpDimensions(buffer) {
  // RIFF container with chunks.
  // Walk chunks to find VP8X/VP8/VP8L.
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.subarray(offset, offset + 4).toString('ascii');
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + chunkSize;
    if (dataEnd > buffer.length) return null;

    if (chunkType === 'VP8X') {
      if (chunkSize < 10) return null;
      const widthMinus1 = buffer[dataOffset + 4] | (buffer[dataOffset + 5] << 8) | (buffer[dataOffset + 6] << 16);
      const heightMinus1 = buffer[dataOffset + 7] | (buffer[dataOffset + 8] << 8) | (buffer[dataOffset + 9] << 16);
      return { width: widthMinus1 + 1, height: heightMinus1 + 1 };
    }

    if (chunkType === 'VP8 ') {
      // Keyframe header contains start code 0x9d 0x01 0x2a, then width/height (14 bits each).
      if (chunkSize < 10) return null;
      const frameOffset = dataOffset;
      if (frameOffset + 10 > buffer.length) return null;
      const start0 = buffer[frameOffset + 3];
      const start1 = buffer[frameOffset + 4];
      const start2 = buffer[frameOffset + 5];
      if (start0 !== 0x9d || start1 !== 0x01 || start2 !== 0x2a) {
        // Not a keyframe (or unexpected layout).
        return null;
      }
      const width = buffer.readUInt16LE(frameOffset + 6) & 0x3fff;
      const height = buffer.readUInt16LE(frameOffset + 8) & 0x3fff;
      if (width <= 0 || height <= 0) return null;
      return { width, height };
    }

    if (chunkType === 'VP8L') {
      // Lossless header: 0x2f then 32-bit little-endian with width/height in 14-bit fields.
      if (chunkSize < 5) return null;
      const sig = buffer[dataOffset];
      if (sig !== 0x2f) return null;
      const bits = buffer.readUInt32LE(dataOffset + 1);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      if (width <= 0 || height <= 0) return null;
      return { width, height };
    }

    offset = dataEnd + (chunkSize % 2); // RIFF chunks pad to even byte boundaries.
  }

  return null;
}

/**
 * Read basic image metadata (currently: PNG width/height) from a Buffer or file path.
 *
 * @param {Buffer|string} input - File bytes or a filesystem path.
 * @returns {Promise<{mime?: string, bytes: number, width?: number, height?: number}>}
 */
export async function readImageInfo(input) {
  const buffer = Buffer.isBuffer(input) ? input : await readFile(input);

  const base = { bytes: buffer.length };

  if (isGif(buffer)) {
    const dims = readGifDimensions(buffer);
    if (dims) return { ...base, mime: 'image/gif', ...dims };
    return { ...base, mime: 'image/gif' };
  }

  if (isWebp(buffer)) {
    const dims = readWebpDimensions(buffer);
    if (dims) return { ...base, mime: 'image/webp', ...dims };
    return { ...base, mime: 'image/webp' };
  }

  if (isJpeg(buffer)) {
    const dims = readJpegSof(buffer);
    if (dims) return { ...base, mime: 'image/jpeg', ...dims };
    return { ...base, mime: 'image/jpeg' };
  }

  if (isPng(buffer)) {
    const ihdr = readPngIhdr(buffer);
    if (ihdr) return { ...base, mime: 'image/png', ...ihdr };
    return { ...base, mime: 'image/png' };
  }

  return base;
}
