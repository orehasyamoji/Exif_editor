import { test } from "node:test";
import assert from "node:assert/strict";
import { createZip, uniqueName, zipTimestamp } from "../src/zip.js";
import { loadPresets, savePresets } from "../src/presets.js";
import { base } from "./fixture.js";
import { unzip } from "./zip-helper.js";
test("36-file ZIP, CRC, Unicode, duplicate paths and case-insensitive collision", async () => {
  const files = Array.from({ length: 36 }, (_, i) => ({
    name:
      i < 3
        ? ["写真.jpg", "写真.jpg", "写真 (2).jpg"][i]
        : i < 5
          ? ["A.jpg", "a.jpg"][i - 3]
          : `frame-${i}.jpg`,
    blob: new Blob([base]),
  }));
  let progress = 0;
  const zip = await createZip(files, (n) => (progress = n)),
    out = unzip(Buffer.from(await zip.arrayBuffer()));
  assert.equal(progress, 36);
  assert.equal(out.length, 36);
  assert.equal(new Set(out.map((x) => x.name.toLowerCase())).size, 36);
  assert.equal(out[1].name, "写真 (2).jpg");
  for (const file of out) assert.deepEqual(file.data, Buffer.from(base));
  assert.equal(uniqueName("../bad\\photo.jpg", new Set()), "__bad_photo.jpg");
});
test("ZIP can be cancelled", async () => {
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    createZip([{ name: "x", blob: new Blob([base]) }], () => {}, c.signal),
    { name: "AbortError" },
  );
});
test("presets persist equipment only and storage errors propagate", () => {
  const store = new Map(),
    storage = {
      getItem: (k) => store.get(k),
      setItem: (k, v) => store.set(k, v),
    };
  assert.deepEqual(loadPresets(storage), []);
  const p = [
    { id: "1", name: "FM2", make: "Nikon", model: "FM2", lens: "50mm" },
  ];
  savePresets(p, storage);
  assert.deepEqual(loadPresets(storage), p);
  assert.throws(
    () =>
      savePresets(p, {
        setItem() {
          throw new Error("quota");
        },
      }),
    /quota/,
  );
  storage.setItem("film-exif-presets-v1", "bad");
  assert.throws(() => loadPresets(storage));
});

test("ZIP uses individual shooting dates and preserves original modified time for unchanged photos", async () => {
  const lastModified = new Date(2026, 10, 7, 21, 30, 31).getTime();
  const dates = [
    "2025-04-02",
    "2025-03-04",
    null,
    "1980-01-01",
    "2107-12-31",
    "2024-02-29",
  ];
  const zip = await createZip(
    dates.map((captureDate, i) => ({
      name: i + ".jpg",
      blob: new Blob([base]),
      captureDate,
      lastModified,
    })),
  );
  const files = unzip(Buffer.from(await zip.arrayBuffer()));
  assert.deepEqual(
    files.map((f) => f.modified),
    [
      [2025, 4, 2, 0, 0, 0],
      [2025, 3, 4, 0, 0, 0],
      [2026, 11, 7, 21, 30, 30],
      [1980, 1, 1, 0, 0, 0],
      [2107, 12, 31, 0, 0, 0],
      [2024, 2, 29, 0, 0, 0],
    ],
  );
  for (const file of files) assert.deepEqual(file.data, Buffer.from(base));
});
test("ZIP range overflow warns and uses original file time; unusable source dates use export time", async () => {
  const lastModified = new Date(2025, 5, 15, 12, 34, 56).getTime();
  for (const captureDate of ["1979-12-31", "2108-01-01", "0001-01-01"]) {
    const stamp = zipTimestamp({ captureDate, lastModified });
    assert.match(stamp.warning, /ZIP/);
    const zip = await createZip([
      { name: "x.jpg", blob: new Blob([base]), timestamp: stamp },
    ]);
    assert.deepEqual(
      unzip(Buffer.from(await zip.arrayBuffer()))[0].modified,
      [2025, 6, 15, 12, 34, 56],
    );
  }
  const fallback = new Date(2026, 10, 7, 22, 0, 0);
  assert.deepEqual(
    zipTimestamp({ lastModified: NaN }, fallback),
    zipTimestamp({ lastModified: fallback.getTime() }),
  );
  assert.deepEqual(
    zipTimestamp({ lastModified: 0 }, fallback),
    zipTimestamp({ lastModified: fallback.getTime() }),
  );
  assert.throws(() => zipTimestamp({ captureDate: "2025-02-30" }), /撮影日/);
});
