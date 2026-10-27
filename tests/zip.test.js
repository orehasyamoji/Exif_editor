import { test } from "node:test";
import assert from "node:assert/strict";
import { createZip, uniqueName } from "../src/zip.js";
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
