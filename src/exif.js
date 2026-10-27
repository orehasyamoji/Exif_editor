// Append replacement IFDs without relocating any existing TIFF data. All old
// offsets (GPS, thumbnails, unknown tags, MakerNotes) remain relative to TIFF.
const enc = new TextEncoder();
const EXIF = [69, 120, 105, 102, 0, 0];
const sizes = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
  13: 4,
};
export const TAG = {
  Make: 0x10f,
  Model: 0x110,
  Exif: 0x8769,
  GPS: 0x8825,
  FNumber: 0x829d,
  ExposureTime: 0x829a,
  ISO: 0x8827,
  Aperture: 0x9202,
  Shutter: 0x9201,
  LensModel: 0xa434,
  MakerNote: 0x927c,
};
const fail = (s) => {
  throw new Error(s);
};
export function jpegSegments(bytes) {
  if (bytes[0] !== 255 || bytes[1] !== 216)
    fail("JPEG の SOI ヘッダーがありません。");
  const out = [];
  let p = 2;
  while (p < bytes.length) {
    const start = p;
    if (bytes[p++] !== 255) fail("JPEG マーカーが不正です。");
    while (bytes[p] === 255) p++;
    const marker = bytes[p++];
    if (marker === 0xda) {
      const length = bytes[p] * 256 + bytes[p + 1];
      if (length < 2 || p + length > bytes.length)
        fail("JPEG のスキャンが壊れています。");
      let end = false;
      for (let i = p + length; i < bytes.length - 1; i++)
        if (bytes[i] === 255 && bytes[i + 1] === 217) {
          end = true;
          break;
        }
      if (!end) fail("JPEG の終端がありません。");
      out.push({ marker, start, end: bytes.length, payload: p + 2 });
      return out;
    }
    if (marker === 0xd9 || marker === 0 || marker === undefined)
      fail("JPEG の画像データがありません。");
    if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push({ marker, start, end: p, payload: p });
      continue;
    }
    const len = bytes[p] * 256 + bytes[p + 1];
    if (!(len >= 2) || p + len > bytes.length)
      fail("JPEG セグメントが壊れています。");
    out.push({ marker, start, end: p + len, payload: p + 2 });
    p += len;
  }
  fail("JPEG の画像データがありません。");
}
const starts = (b, p, a) => a.every((x, i) => b[p + i] === x);
export function readTiff(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8) fail("EXIF ヘッダーが短すぎます。");
  const le = bytes[0] === 73 && bytes[1] === 73;
  if (!le && !(bytes[0] === 77 && bytes[1] === 77))
    fail("EXIF のバイト順が不正です。");
  const range = (p, n) => {
    if (!Number.isSafeInteger(p) || p < 0 || p + n > bytes.length)
      fail("EXIF の参照範囲が不正です。");
  };
  const u16 = (p) => {
    range(p, 2);
    return v.getUint16(p, le);
  };
  const u32 = (p) => {
    range(p, 4);
    return v.getUint32(p, le);
  };
  if (u16(2) !== 42) fail("未対応の TIFF 形式です。");
  const ifd = (p) => {
    if (p === 0) return { entries: [], next: 0 };
    if (p < 8) fail("EXIF の IFD 位置が不正です。");
    const n = u16(p);
    range(p + 2, n * 12 + 4);
    const entries = [];
    const seen = new Set();
    for (let i = 0; i < n; i++) {
      const pos = p + 2 + i * 12,
        tag = u16(pos),
        type = u16(pos + 2),
        count = u32(pos + 4);
      if (seen.has(tag)) fail("EXIF に重複タグがあり、安全に編集できません。");
      seen.add(tag);
      const size = sizes[type];
      if (!size) fail("未対応の EXIF データ型です。");
      const len = size * count,
        offset = len > 4 ? u32(pos + 8) : pos + 8;
      range(offset, len);
      entries.push({
        tag,
        type,
        count,
        offset,
        raw: bytes.slice(pos, pos + 12),
      });
    }
    return { entries, next: u32(p + 2 + n * 12) };
  };
  const root = ifd(u32(4));
  const ptr = (entries, tag) => {
    const e = entries.find((e) => e.tag === tag);
    if (!e) return 0;
    if (e.type !== 4 || e.count !== 1)
      fail("EXIF の IFD ポインターが不正です。");
    return u32(e.offset);
  };
  const exif = ifd(ptr(root.entries, TAG.Exif));
  const gps = ifd(ptr(root.entries, TAG.GPS));
  // Validate the linked thumbnail chain without altering it.
  const visited = new Set();
  let next = root.next;
  while (next) {
    if (visited.has(next) || visited.size > 32)
      fail("EXIF の IFD が循環しています。");
    visited.add(next);
    next = ifd(next).next;
  }
  return { v, le, u16, u32, ifd, root, exif, gps, bytes };
}
export function parseExposure(input) {
  const s = String(input ?? "").trim();
  if (!s) return null;
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)(?:\s*\/\s*(?:\d+(?:\.\d+)?|\.\d+))?$/.test(s))
    fail("露出値は正の数または 1/125 のような分数で入力してください。");
  const [a, b = "1"] = s.split("/");
  const n = Number(a) / Number(b);
  if (!Number.isFinite(n) || n <= 0 || n > 1000000 || n < 0.000001)
    fail("露出値は 0.000001〜1000000 の範囲で指定してください。");
  return n;
}
export function validateSettings(s) {
  const iso = Number(s.iso);
  if (
    !/^\d+$/.test(String(s.iso)) ||
    !Number.isInteger(iso) ||
    iso < 1 ||
    iso > 0xffffffff
  )
    fail("ISO は 1〜4294967295 の整数で入力してください。");
  for (const key of ["make", "model", "lens"]) {
    if (
      typeof s[key] !== "string" ||
      s[key].includes("\0") ||
      enc.encode(s[key]).length > 1024
    )
      fail("機材名は NUL を含まない 1024 バイト以内の文字列にしてください。");
  }
  return { ...s, iso, f: parseExposure(s.f), time: parseExposure(s.time) };
}
function rational(n, signed, le) {
  const limit = signed ? 0x7fffffff : 0xffffffff;
  let x = Math.abs(n),
    h0 = 0,
    h1 = 1,
    k0 = 1,
    k1 = 0,
    a = 0,
    d = 1;
  for (let i = 0; i < 40; i++) {
    const q = Math.floor(x),
      h = q * h1 + h0,
      k = q * k1 + k0;
    if (h > limit || k > limit) break;
    a = h;
    d = k;
    if (Math.abs(a / d - Math.abs(n)) <= 1e-12 * Math.max(1, Math.abs(n)))
      break;
    h0 = h1;
    h1 = h;
    k0 = k1;
    k1 = k;
    const fraction = x - q;
    if (!fraction) break;
    x = 1 / fraction;
  }
  if (n < 0) a = -a;
  if (!signed && a === 0 && n !== 0) fail("値が小さすぎて EXIF に記録できません。");
  const b = new Uint8Array(8),
    v = new DataView(b.buffer);
  if (signed) v.setInt32(0, a, le);
  else v.setUint32(0, a, le);
  v.setUint32(4, d, le);
  return b;
}
export function editJpeg(bytes, settings) {
  const s = validateSettings(settings),
    segments = jpegSegments(bytes),
    warnings = [];
  const exifs = segments.filter(
    (x) => x.marker === 0xe1 && starts(bytes, x.payload, EXIF),
  );
  if (exifs.length > 1)
    fail("複数の EXIF セグメントがあるため、安全のため処理しません。");
  if (
    segments.some(
      (x) => x.marker === 0xe2 && starts(bytes, x.payload, [77, 80, 70, 0]),
    )
  )
    fail("MPF / MPO 形式は画像オフセットの保持を保証できないため未対応です。");
  if (
    segments.some((x) => x.marker === 0xe1 && !starts(bytes, x.payload, EXIF))
  )
    warnings.push(
      "XMP などの APP1 メタデータは保持しました。機材・露出の別記がある場合は古い値が残ります。",
    );
  if (segments.some((x) => x.marker === 0xed))
    warnings.push(
      "IPTC / Photoshop メタデータは保持しました。別記された機材・露出は更新しません。",
    );
  const old = exifs[0];
  const tiff = old
    ? bytes.slice(old.payload + 6, old.end)
    : new Uint8Array([73, 73, 42, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const t = readTiff(tiff),
    le = t.le;
  if (t.exif.entries.some((e) => e.tag === TAG.MakerNote))
    warnings.push(
      "MakerNote は元の位置で保持しました。メーカー独自の機材・露出値は更新できません。",
    );
  if (t.root.next)
    warnings.push(
      "埋め込みサムネイルとそのメタデータは保持しました。サムネイル側の機材・露出は更新しません。",
    );
  if ([s.make, s.model, s.lens].some((x) => /[^\x20-\x7e]/.test(x)))
    warnings.push(
      "日本語などの機材名は UTF-8 で保存します。EXIF の ASCII のみを読むソフトでは文字化けする場合があります。",
    );
  if (!s.make || !s.model || !s.lens)
    warnings.push("空欄の機材タグは削除しました。");
  let length = (tiff.length + 1) & ~1;
  const chunks = [{ offset: 0, data: tiff }];
  const allocate = (data) => {
    const p = length;
    chunks.push({ offset: p, data });
    length = (length + data.length + 1) & ~1;
    return p;
  };
  const entry = (tag, type, count, data) => {
    const raw = new Uint8Array(12),
      v = new DataView(raw.buffer);
    v.setUint16(0, tag, le);
    v.setUint16(2, type, le);
    v.setUint32(4, count, le);
    if (data.length <= 4) raw.set(data, 8);
    else v.setUint32(8, allocate(data), le);
    return { tag, raw };
  };
  const ascii = (tag, str) => {
    const data = enc.encode(str + "\0");
    return entry(tag, 2, data.length, data);
  };
  const number = (tag, n, type = 4) => {
    const b = new Uint8Array(type === 3 ? 2 : 4),
      v = new DataView(b.buffer);
    if (type === 3) v.setUint16(0, n, le);
    else v.setUint32(0, n, le);
    return entry(tag, type, 1, b);
  };
  const replace = (entries, remove, add) =>
    entries
      .filter((e) => !remove.includes(e.tag))
      .concat(add)
      .sort((a, b) => a.tag - b.tag);
  const exifAdd = [
    number(TAG.ISO, Math.min(s.iso, 65535), 3),
    number(0x8830, 3, 3),
    number(0x8833, s.iso),
  ];
  if (s.lens) exifAdd.push(ascii(TAG.LensModel, s.lens));
  if (s.f !== null)
    exifAdd.push(
      entry(TAG.FNumber, 5, 1, rational(s.f, false, le)),
      ...(s.f >= 1
        ? [entry(TAG.Aperture, 5, 1, rational(2 * Math.log2(s.f), false, le))]
        : []),
    );
  if (s.time !== null)
    exifAdd.push(
      entry(TAG.ExposureTime, 5, 1, rational(s.time, false, le)),
      entry(TAG.Shutter, 10, 1, rational(-Math.log2(s.time), true, le)),
    );
  if (s.f !== null && s.f < 1)
    warnings.push(
      "F1 未満のため、負値を表現できない ApertureValue は削除し FNumber を記録しました。",
    );
  const exposureTags = [
    TAG.FNumber,
    TAG.Aperture,
    TAG.ExposureTime,
    TAG.Shutter,
  ];
  const lensTags = [0xa432, 0xa433, 0xa434, 0xa435];
  const isoTags = [TAG.ISO, 0x8830, 0x8831, 0x8832, 0x8833, 0x8834, 0x8835];
  const exifEntries = replace(
    t.exif.entries,
    [...exposureTags, ...lensTags, ...isoTags, 0xa431, 0x9205],
    exifAdd,
  );
  if (
    t.exif.entries.some((e) =>
      [0xa432, 0xa433, 0xa435, 0xa431, 0x9205].includes(e.tag),
    )
  )
    warnings.push(
      "複写機材のレンズ仕様・メーカー・シリアル番号、ボディ番号、最大絞り値は矛盾を避けるため削除しました。",
    );
  if (
    t.exif.entries.some((e) =>
      [0x920a, 0xa405, 0x9204, 0x9207, 0x9209].includes(e.tag),
    )
  )
    warnings.push(
      "焦点距離・露出補正・測光・フラッシュ等の対象外タグは元の値を保持します。必要なら別ツールで確認してください。",
    );
  const writeIfd = (entries, next) => {
    const data = new Uint8Array(2 + 12 * entries.length + 4),
      v = new DataView(data.buffer);
    v.setUint16(0, entries.length, le);
    entries.forEach((e, i) => data.set(e.raw, 2 + i * 12));
    v.setUint32(2 + entries.length * 12, next, le);
    return allocate(data);
  };
  const exifOffset = writeIfd(exifEntries, t.exif.next);
  const rootAdd = [number(TAG.Exif, exifOffset)];
  if (s.make) rootAdd.push(ascii(TAG.Make, s.make));
  if (s.model) rootAdd.push(ascii(TAG.Model, s.model));
  const rootEntries = replace(
    t.root.entries,
    [TAG.Make, TAG.Model, TAG.Exif, ...exposureTags, ...isoTags, ...lensTags],
    rootAdd,
  );
  const rootOffset = writeIfd(rootEntries, t.root.next);
  if (length + 8 > 65535)
    fail(
      "EXIF が JPEG APP1 の上限（約64KB）を超えます。元データを壊さないため処理しません。",
    );
  const result = new Uint8Array(length);
  chunks.forEach((c) => result.set(c.data, c.offset));
  new DataView(result.buffer).setUint32(4, rootOffset, le);
  const app = new Uint8Array(10 + length);
  app.set([255, 225, (length + 8) >> 8, (length + 8) & 255, ...EXIF]);
  app.set(result, 10);
  // Blob parts reuse the original compressed image bytes; no image decoding.
  const insert = segments[0]?.marker === 0xe0 ? segments[0].end : 2;
  const parts = old
    ? [bytes.subarray(0, old.start), app, bytes.subarray(old.end)]
    : [bytes.subarray(0, insert), app, bytes.subarray(insert)];
  return { blob: new Blob(parts, { type: "image/jpeg" }), warnings };
}
