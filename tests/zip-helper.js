import assert from "node:assert/strict";
import { crc32 } from "node:zlib";
export function unzip(buffer) {
  const files = [];
  let p = 0;
  while (buffer.readUInt32LE(p) === 0x04034b50) {
    assert.equal(buffer.readUInt16LE(p + 8), 0);
    const size = buffer.readUInt32LE(p + 18),
      n = buffer.readUInt16LE(p + 26),
      extra = buffer.readUInt16LE(p + 28);
    const name = buffer.toString("utf8", p + 30, p + 30 + n),
      start = p + 30 + n + extra,
      data = buffer.subarray(start, start + size);
    assert.equal(
      crc32(data),
      buffer.readUInt32LE(p + 14),
      "independent CRC validation",
    );
    files.push({ name, data });
    p = start + size;
  }
  const central = p;
  for (const file of files) {
    assert.equal(buffer.readUInt32LE(p), 0x02014b50);
    const n = buffer.readUInt16LE(p + 28);
    assert.equal(buffer.toString("utf8", p + 46, p + 46 + n), file.name);
    p += 46 + n + buffer.readUInt16LE(p + 30) + buffer.readUInt16LE(p + 32);
  }
  assert.equal(buffer.readUInt32LE(p), 0x06054b50);
  assert.equal(buffer.readUInt16LE(p + 10), files.length);
  assert.equal(buffer.readUInt32LE(p + 16), central);
  return files;
}
