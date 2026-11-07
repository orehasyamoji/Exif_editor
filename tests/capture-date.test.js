import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("compatibility offset follows the device timezone and DST on the shooting date", () => {
  const module = new URL("../src/capture-date.js", import.meta.url).href;
  for (const [zone, expected] of [
    ["Asia/Tokyo", ["+09:00", "+09:00"]],
    ["America/New_York", ["-05:00", "-04:00"]],
    ["UTC", ["+00:00", "+00:00"]],
  ]) {
    const script = `import {captureDateOffset} from ${JSON.stringify(module)}; console.log(JSON.stringify(['2025-01-15','2025-07-15'].map(captureDateOffset)));`;
    const result = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      { env: { ...process.env, TZ: zone }, encoding: "utf8" },
    );
    assert.deepEqual(JSON.parse(result), expected);
  }
});
