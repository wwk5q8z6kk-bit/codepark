import assert from 'node:assert/strict';
import { writeFile, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import zlib from 'node:zlib';

import { readImageInfo } from '../src/imageInfo.js';

function crc32(buffer) {
  // Standard CRC-32 (IEEE 802.3), used by PNG.
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(typeAscii4, data) {
  assert.equal(typeAscii4.length, 4);
  const type = Buffer.from(typeAscii4, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.concat([type, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcBuf), 0);
  return Buffer.concat([length, type, data, crc]);
}

function makeTinyPng({ width, height }) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type: RGBA
  ihdr.writeUInt8(0, 10); // compression method
  ihdr.writeUInt8(0, 11); // filter method
  ihdr.writeUInt8(0, 12); // interlace method

  // Raw image data: each scanline starts with a filter byte 0.
  // For 1x1 RGBA: 0 + 4 bytes.
  const pixel = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]); // filter=0, RGBA=(0,0,0,0)
  const idatData = zlib.deflateSync(pixel);

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idatData),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function makeTinyJpeg({ width, height }) {
  const soi = Buffer.from([0xff, 0xd8]);

  // APP0 JFIF segment (length includes itself).
  const app0Payload = Buffer.from([
    0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
    0x01, 0x02, // version
    0x00, // units
    0x00, 0x01, // X density
    0x00, 0x01, // Y density
    0x00, 0x00 // thumbnail
  ]);
  const app0Len = Buffer.alloc(2);
  app0Len.writeUInt16BE(app0Payload.length + 2, 0);
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0]), app0Len, app0Payload]);

  // SOF0 segment with dimensions.
  const sof0Payload = Buffer.alloc(17 - 2); // length includes 2-byte length field
  sof0Payload.writeUInt8(8, 0); // precision
  sof0Payload.writeUInt16BE(height, 1);
  sof0Payload.writeUInt16BE(width, 3);
  sof0Payload.writeUInt8(3, 5); // components
  // Component specs (3 * 3 bytes): id, sampling, quant table.
  sof0Payload.writeUInt8(1, 6);
  sof0Payload.writeUInt8(0x11, 7);
  sof0Payload.writeUInt8(0, 8);
  sof0Payload.writeUInt8(2, 9);
  sof0Payload.writeUInt8(0x11, 10);
  sof0Payload.writeUInt8(0, 11);
  sof0Payload.writeUInt8(3, 12);
  sof0Payload.writeUInt8(0x11, 13);
  sof0Payload.writeUInt8(0, 14);

  const sof0Len = Buffer.alloc(2);
  sof0Len.writeUInt16BE(sof0Payload.length + 2, 0);
  const sof0 = Buffer.concat([Buffer.from([0xff, 0xc0]), sof0Len, sof0Payload]);

  const eoi = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([soi, app0, sof0, eoi]);
}

function makeTinyWebpVp8x({ width, height }) {
  const chunkType = Buffer.from('VP8X', 'ascii');
  const chunkSize = Buffer.alloc(4);
  chunkSize.writeUInt32LE(10, 0);
  const chunkData = Buffer.alloc(10);
  // flags (0) + 3 reserved + 3 bytes width-1 + 3 bytes height-1
  const widthMinus1 = width - 1;
  const heightMinus1 = height - 1;
  chunkData[4] = widthMinus1 & 0xff;
  chunkData[5] = (widthMinus1 >> 8) & 0xff;
  chunkData[6] = (widthMinus1 >> 16) & 0xff;
  chunkData[7] = heightMinus1 & 0xff;
  chunkData[8] = (heightMinus1 >> 8) & 0xff;
  chunkData[9] = (heightMinus1 >> 16) & 0xff;

  const riffHeader = Buffer.from('RIFF', 'ascii');
  const webpHeader = Buffer.from('WEBP', 'ascii');
  const fileSize = 12 + 8 + 10;
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(fileSize - 8, 0);

  return Buffer.concat([
    riffHeader,
    riffSize,
    webpHeader,
    chunkType,
    chunkSize,
    chunkData
  ]);
}

function makeTinyGif({ width, height, version = '89a' }) {
  assert.ok(version === '87a' || version === '89a');
  const header = Buffer.from(`GIF${version}`, 'ascii');
  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(width, 0); // canvas width
  lsd.writeUInt16LE(height, 2); // canvas height
  lsd.writeUInt8(0x00, 4); // packed fields: no global color table
  lsd.writeUInt8(0x00, 5); // background color index
  lsd.writeUInt8(0x00, 6); // pixel aspect ratio
  const trailer = Buffer.from([0x3b]); // GIF trailer
  return Buffer.concat([header, lsd, trailer]);
}

test('readImageInfo reads PNG metadata from Buffer', async () => {
  const png = makeTinyPng({ width: 1, height: 1 });
  const info = await readImageInfo(png);
  assert.equal(info.mime, 'image/png');
  assert.equal(info.bytes, png.length);
  assert.equal(info.width, 1);
  assert.equal(info.height, 1);
});

test('readImageInfo reads PNG metadata from a file path', async () => {
  const png = makeTinyPng({ width: 2, height: 3 });
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codepark-imageinfo-'));
  const file = path.join(dir, 'tiny.png');
  await writeFile(file, png);

  const info = await readImageInfo(file);
  assert.equal(info.mime, 'image/png');
  assert.equal(info.bytes, png.length);
  assert.equal(info.width, 2);
  assert.equal(info.height, 3);
});

test('readImageInfo reads JPEG metadata from Buffer', async () => {
  const jpeg = makeTinyJpeg({ width: 5, height: 7 });
  const info = await readImageInfo(jpeg);
  assert.equal(info.mime, 'image/jpeg');
  assert.equal(info.bytes, jpeg.length);
  assert.equal(info.width, 5);
  assert.equal(info.height, 7);
});

test('readImageInfo reads WebP metadata from Buffer', async () => {
  const webp = makeTinyWebpVp8x({ width: 9, height: 11 });
  const info = await readImageInfo(webp);
  assert.equal(info.mime, 'image/webp');
  assert.equal(info.bytes, webp.length);
  assert.equal(info.width, 9);
  assert.equal(info.height, 11);
});

test('readImageInfo reads GIF metadata from Buffer', async () => {
  const gif = makeTinyGif({ width: 13, height: 17, version: '89a' });
  const info = await readImageInfo(gif);
  assert.equal(info.mime, 'image/gif');
  assert.equal(info.bytes, gif.length);
  assert.equal(info.width, 13);
  assert.equal(info.height, 17);
});
