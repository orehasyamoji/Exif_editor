// ZIP STORE: JPEGs are already compressed. Blob parts avoid concatenating a
// second giant Uint8Array. CRC is computed in 1 MiB chunks.
const encoder = new TextEncoder();
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(bytes, crc = 0xffffffff) {
  for (const b of bytes) crc = table[(crc ^ b) & 255] ^ (crc >>> 8);
  return crc >>> 0;
}
export function uniqueName(name, used) {
  const clean =
    name.replace(/[\\/\u0000-\u001f\u007f]/g, "_").replace(/^\.+/, "_") ||
    "photo.jpg";
  const p = clean.lastIndexOf("."),
    base = p > 0 ? clean.slice(0, p) : clean,
    ext = p > 0 ? clean.slice(p) : "";
  let candidate = clean,
    i = 2;
  while (used.has(candidate.normalize("NFC").toLowerCase()))
    candidate = `${base} (${i++})${ext}`;
  used.add(candidate.normalize("NFC").toLowerCase());
  return candidate;
}
const header = (n) => {
  const b = new Uint8Array(n);
  return { b, v: new DataView(b.buffer) };
};
export async function createZip(files, onProgress = () => {}, signal) {
  if (files.length > 65535)
    throw new Error("ZIP のファイル数上限を超えました。");
  const parts = [],
    central = [],
    used = new Set();
  let offset = 0,
    index = 0;
  for (const file of files) {
    signal?.throwIfAborted();
    let crc = 0xffffffff;
    for (let p = 0; p < file.blob.size; p += 1048576) {
      signal?.throwIfAborted();
      crc = crc32(
        new Uint8Array(await file.blob.slice(p, p + 1048576).arrayBuffer()),
        crc,
      );
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const name = encoder.encode(uniqueName(file.name, used)),
      size = file.blob.size;
    if (name.length > 65535 || offset + size + name.length + 30 > 0xffffffff)
      throw new Error("ZIP64 が必要なサイズには対応していません。");
    const { b, v } = header(30);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x800, true);
    v.setUint16(12, 0x21, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, size, true);
    v.setUint32(22, size, true);
    v.setUint16(26, name.length, true);
    parts.push(b, name, file.blob);
    const h = header(46);
    h.v.setUint32(0, 0x02014b50, true);
    h.v.setUint16(4, 20, true);
    h.v.setUint16(6, 20, true);
    h.v.setUint16(8, 0x800, true);
    h.v.setUint16(14, 0x21, true);
    h.v.setUint32(16, crc, true);
    h.v.setUint32(20, size, true);
    h.v.setUint32(24, size, true);
    h.v.setUint16(28, name.length, true);
    h.v.setUint32(42, offset, true);
    central.push(h.b, name);
    offset += 30 + name.length + size;
    onProgress(++index, files.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  const csize = central.reduce((n, b) => n + b.length, 0);
  const end = header(22);
  if (offset + csize + 22 > 0xffffffff)
    throw new Error("ZIP のサイズ上限を超えました。");
  end.v.setUint32(0, 0x06054b50, true);
  end.v.setUint16(8, files.length, true);
  end.v.setUint16(10, files.length, true);
  end.v.setUint32(12, csize, true);
  end.v.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.b], { type: "application/zip" });
}
