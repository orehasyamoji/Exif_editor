import { readFileSync } from "node:fs";
export const base = new Uint8Array(
  readFileSync(new URL("./fixtures/base.jpg", import.meta.url)),
);
export function segment(marker, data) {
  const out = new Uint8Array(data.length + 4);
  out.set([255, marker, (data.length + 2) >> 8, (data.length + 2) & 255]);
  out.set(data, 4);
  return out;
}
export function fixture(le = true) {
  const b = new Uint8Array(1400),
    v = new DataView(b.buffer);
  let p = 8;
  b.set(le ? [73, 73, 42, 0] : [77, 77, 0, 42]);
  const u16 = (p, n) => v.setUint16(p, n, le),
    u32 = (p, n) => v.setUint32(p, n, le);
  const value = (tag, type, data, count) => {
    const raw = new Uint8Array(12),
      w = new DataView(raw.buffer);
    w.setUint16(0, tag, le);
    w.setUint16(2, type, le);
    w.setUint32(4, count, le);
    if (data.length <= 4) raw.set(data, 8);
    else {
      w.setUint32(8, p, le);
      b.set(data, p);
      p = (p + data.length + 1) & ~1;
    }
    return { tag, raw };
  };
  const str = (tag, s) =>
    value(tag, 2, new TextEncoder().encode(s + "\0"), s.length + 1);
  const num = (tag, n, type = 4) => {
    const a = new Uint8Array(type === 3 ? 2 : 4),
      w = new DataView(a.buffer);
    if (type === 3) w.setUint16(0, n, le);
    else w.setUint32(0, n, le);
    return value(tag, type, a, 1);
  };
  const rat = (tag, n, d, type = 5) => {
    const a = new Uint8Array(8),
      w = new DataView(a.buffer);
    w.setUint32(0, n, le);
    w.setUint32(4, d, le);
    return value(tag, type, a, 1);
  };
  const ifd = (entries, next = 0) => {
    entries.sort((a, b) => a.tag - b.tag);
    const start = p;
    u16(p, entries.length);
    p += 2;
    for (const e of entries) {
      b.set(e.raw, p);
      p += 12;
    }
    u32(p, next);
    p += 4;
    return start;
  };
  const maker = value(
    0x927c,
    7,
    new Uint8Array([70, 73, 76, 77, 1, 2, 3, 4, 5, 6]),
    10,
  );
  const exif = ifd([
    str(0x9003, "1998:07:12 15:30:00"),
    str(0x9004, "2026:10:27 10:00:00"),
    num(0xa002, 16),
    num(0xa003, 12),
    str(0xa434, "Digital lens"),
    num(0x8827, 6400, 3),
    num(0x8831, 6400),
    num(0x8832, 6400),
    num(0x8834, 6400),
    num(0x8835, 6400),
    num(0x8830, 1, 3),
    rat(0x829d, 8, 1),
    rat(0x9202, 6, 1),
    rat(0x829a, 1, 250),
    rat(0x9201, 8, 1, 10),
    rat(0x9205, 4, 1),
    str(0xa431, "copy-body-123"),
    str(0xa433, "copy-lens-maker"),
    str(0xa435, "copy-lens-456"),
    maker,
  ]);
  const gps = ifd([str(1, "N"), rat(2, 35, 1)]);
  const thumb = ifd([num(0x112, 1, 3)]);
  const root = ifd(
    [
      str(0x10f, "Digital maker"),
      str(0x110, "Digital camera"),
      num(0x112, 6, 3),
      str(0x132, "2026:10:27 10:00:00"),
      num(0x8769, exif),
      num(0x8825, gps),
    ],
    thumb,
  );
  u32(4, root);
  const tiff = b.slice(0, p),
    payload = new Uint8Array(6 + tiff.length);
  payload.set([69, 120, 105, 102, 0, 0]);
  payload.set(tiff, 6);
  const extras = [
    segment(0xe1, payload),
    segment(
      0xe2,
      new TextEncoder().encode("ICC_PROFILE\0\x01\x01unchanged profile"),
    ),
    segment(
      0xe1,
      new TextEncoder().encode(
        "http://ns.adobe.com/xap/1.0/\0<xmp>unchanged</xmp>",
      ),
    ),
    segment(0xed, new TextEncoder().encode("Photoshop 3.0\0unchanged")),
  ];
  const out = new Uint8Array(
    base.length + extras.reduce((s, x) => s + x.length, 0),
  );
  out.set(base.subarray(0, 2));
  p = 2;
  for (const a of extras) {
    out.set(a, p);
    p += a.length;
  }
  out.set(base.subarray(2), p);
  return out;
}
