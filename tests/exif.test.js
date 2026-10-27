import { test } from "node:test";
import assert from "node:assert/strict";
import exifReader from "exif-reader";
import {
  editJpeg,
  jpegSegments,
  readTiff,
  parseExposure,
} from "../src/exif.js";
import { fixture, base, segment } from "./fixture.js";
const settings = {
  make: "Nikon",
  model: "FM2",
  lens: "Nikkor 50mm f/1.4",
  iso: "400",
  f: "2.8",
  time: "1/125",
};
const bytes = async (r) => new Uint8Array(await r.blob.arrayBuffer());
const exifSegment = (b) =>
  jpegSegments(b).find((s) => s.marker === 0xe1 && b[s.payload] === 69);
function decode(b) {
  const s = exifSegment(b);
  return exifReader(Buffer.from(b.subarray(s.payload, s.end)));
}
function tiff(b) {
  const s = exifSegment(b);
  return readTiff(b.subarray(s.payload + 6, s.end));
}
const withoutExif = (b) =>
  Buffer.concat([
    Buffer.from(b.subarray(0, 2)),
    ...jpegSegments(b)
      .filter(
        (s) => s !== undefined && !(s.marker === 0xe1 && b[s.payload] === 69),
      )
      .map((s) => Buffer.from(b.subarray(s.start, s.end))),
  ]);
for (const le of [true, false])
  test(`camera/ISO/APEX and metadata preservation (${le ? "II" : "MM"})`, async () => {
    const before = fixture(le),
      result = editJpeg(before, settings),
      after = await bytes(result),
      d = decode(after),
      original = decode(before);
    assert.equal(d.Image.Make, "Nikon");
    assert.equal(d.Image.Model, "FM2");
    assert.equal(d.Photo.LensModel, settings.lens);
    assert.equal(d.Photo.ISOSpeedRatings, 400);
    assert.equal(d.Photo.ISOSpeed, 400);
    assert.equal(d.Photo.SensitivityType, 3);
    assert.equal(d.Photo.FNumber, 2.8);
    assert.equal(d.Photo.ExposureTime, 1 / 125);
    assert.ok(Math.abs(d.Photo.ApertureValue - 2 * Math.log2(2.8)) < 1e-8);
    assert.ok(Math.abs(d.Photo.ShutterSpeedValue - Math.log2(125)) < 1e-8);
    assert.deepEqual(d.Photo.DateTimeOriginal, original.Photo.DateTimeOriginal);
    assert.deepEqual(
      d.Photo.DateTimeDigitized,
      original.Photo.DateTimeDigitized,
    );
    assert.deepEqual(d.GPSInfo, original.GPSInfo);
    assert.equal(d.Image.Orientation, 6);
    assert.equal(d.Photo.PixelXDimension, 16);
    assert.equal(d.Photo.PixelYDimension, 12);
    assert.deepEqual(d.Photo.MakerNote, original.Photo.MakerNote);
    assert.deepEqual(d.Thumbnail, original.Thumbnail);
    assert.deepEqual(
      withoutExif(after),
      withoutExif(before),
      "ALL non-EXIF bytes including ICC/XMP/APP13 and entropy identical",
    );
    const a = tiff(after),
      b = tiff(before);
    assert.deepEqual(
      a.bytes.subarray(8, b.bytes.length),
      b.bytes.subarray(8),
      "original TIFF offset/data payload unchanged",
    );
    assert.ok(result.warnings.some((w) => w.includes("MakerNote")));
    assert.ok(result.warnings.some((w) => w.includes("XMP")));
    for (const tag of [
      0x8831, 0x8832, 0x8834, 0x8835, 0xa431, 0xa433, 0xa435, 0x9205,
    ])
      assert.ok(!a.exif.entries.some((e) => e.tag === tag));
  });
test("unset exposure removes all associated tags, independently", async () => {
  for (const f of ["", "4"])
    for (const time of ["", "1/60"]) {
      const out = await bytes(editJpeg(fixture(), { ...settings, f, time }));
      const d = decode(out);
      for (const key of ["FNumber", "ApertureValue"])
        assert.equal(d.Photo[key] !== undefined, !!f);
      for (const key of ["ExposureTime", "ShutterSpeedValue"])
        assert.equal(d.Photo[key] !== undefined, !!time);
      if (time) assert.equal(d.Photo.ExposureTime, 1 / 60);
    }
});
test("creates EXIF for original without EXIF; repeat edit; empty camera deletes tags", async () => {
  const first = await bytes(editJpeg(base, settings)),
    second = await bytes(
      editJpeg(first, {
        ...settings,
        make: "",
        model: "",
        lens: "",
        iso: "70000",
        f: "",
        time: "",
      }),
    ),
    d = decode(second);
  assert.equal(d.Image.Make, undefined);
  assert.equal(d.Image.Model, undefined);
  assert.equal(d.Photo.LensModel, undefined);
  assert.equal(d.Photo.ISOSpeedRatings, 65535);
  assert.equal(d.Photo.ISOSpeed, 70000);
  assert.deepEqual(withoutExif(second), withoutExif(base));
});
test("fractional f < 1, long exposure, extended ISO, UTF-8", async () => {
  const r = editJpeg(base, {
      ...settings,
      make: "ニコン",
      iso: "4294967295",
      f: "0.95",
      time: "30",
    }),
    d = decode(await bytes(r));
  assert.equal(d.Photo.FNumber, 0.95);
  assert.equal(d.Photo.ApertureValue, undefined);
  assert.equal(d.Photo.ShutterSpeedValue < 0, true);
  assert.equal(d.Photo.ISOSpeed, 4294967295);
  assert.ok(r.warnings.some((x) => x.includes("UTF-8")));
});
test("invalid values and corrupt/unsupported metadata fail safely", () => {
  for (const iso of ["0", "-1", "1.5", "abc", "4294967296"])
    assert.throws(() => editJpeg(base, { ...settings, iso }));
  for (const s of ["0", "-2", "1/0", "NaN", "1//2", "1e3"])
    assert.throws(() => parseExposure(s));
  assert.equal(parseExposure(""), null);
  assert.equal(parseExposure("1/125"), 0.008);
  assert.throws(() => editJpeg(new Uint8Array([1, 2]), settings));
  const bad = fixture();
  const e = exifSegment(bad);
  bad[e.payload + 6 + 4] = 255;
  bad[e.payload + 6 + 5] = 255;
  assert.throws(() => editJpeg(bad, settings));
  const append = (a, x) =>
    new Uint8Array([...a.subarray(0, 2), ...x, ...a.subarray(2)]);
  assert.throws(
    () =>
      editJpeg(
        append(
          fixture(),
          segment(0xe1, new Uint8Array([69, 120, 105, 102, 0, 0])),
        ),
        settings,
      ),
    /複数/,
  );
  assert.throws(
    () =>
      editJpeg(
        append(base, segment(0xe2, new Uint8Array([77, 80, 70, 0]))),
        settings,
      ),
    /MPF/,
  );
});
test("APP1 capacity limit is a per-file error, never truncates metadata", () => {
  const source = fixture(),
    e = exifSegment(source),
    payload = new Uint8Array(65533);
  payload.set(source.subarray(e.payload, e.end));
  const large = new Uint8Array([
    ...source.subarray(0, e.start),
    ...segment(0xe1, payload),
    ...source.subarray(e.end),
  ]);
  assert.throws(() => editJpeg(large, settings), /64KB/);
});

test('standard exposure choices include f/1 and zero APEX without dummy unset values', async () => {
  for (const f of ['1','1.2','1.4','1.8','2','2.8','4','5.6','8','11','16','22','32']) {
    const d=decode(await bytes(editJpeg(base,{...settings,f,time:'1'})));
    assert.equal(d.Photo.FNumber,Number(f));
    assert.ok(Math.abs(d.Photo.ApertureValue-2*Math.log2(Number(f)))<1e-8);
    assert.equal(d.Photo.ShutterSpeedValue,0);
  }
  for(const time of ['1/8000','1/4000','1/2000','1/1000','1/500','1/250','1/125','1/60','1/30','1/15','1/8','1/4','1/2','1','2','4','8','15','30']) {
    const d=decode(await bytes(editJpeg(base,{...settings,time}))),[n,den='1']=time.split('/'),expected=Number(n)/Number(den);
    assert.equal(d.Photo.ExposureTime,expected);
    assert.ok(Math.abs(d.Photo.ShutterSpeedValue+Math.log2(expected))<1e-8);
  }
});
