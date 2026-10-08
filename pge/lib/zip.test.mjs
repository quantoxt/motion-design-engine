import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zip, crc32 } from './zip.mjs';

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xCBF43926);
});

test('stored zip: local headers, data verbatim, central directory and end record', () => {
  const a = Buffer.from('panel one'), b = Buffer.from('panel two!');
  const z = zip([{ name: 'job/a.png', data: a }, { name: 'job/b.png', data: b }]);
  assert.equal(z.readUInt32LE(0), 0x04034b50);
  assert.equal(z.subarray(30 + 9, 30 + 9 + a.length).toString(), 'panel one');
  const end = z.subarray(z.length - 22);
  assert.equal(end.readUInt32LE(0), 0x06054b50);
  assert.equal(end.readUInt16LE(10), 2);
  const cdOffset = end.readUInt32LE(16);
  assert.equal(z.readUInt32LE(cdOffset), 0x02014b50);
  assert.equal(cdOffset, 30 + 9 + a.length + 30 + 9 + b.length);
});
