import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import exifReader from "exif-reader";
import { fixture } from "../fixture.js";
import { jpegSegments } from "../../src/exif.js";
import { unzip } from "../zip-helper.js";
const photo = (name = "frame.jpg", buffer = fixture()) => ({
  name,
  mimeType: "image/jpeg",
  buffer: Buffer.from(buffer),
});
const decode = (bytes) => {
  const s = jpegSegments(bytes).find(
    (s) => s.marker === 0xe1 && bytes[s.payload] === 69,
  );
  return exifReader(bytes.subarray(s.payload, s.end));
};
async function download(page) {
  const event = page.waitForEvent("download");
  await page.getByRole("link", { name: "ZIPを保存" }).click();
  return unzip(await readFile(await (await event).path()));
}
test("36 photos batch edit, duplicate-safe ZIP, failures named, no upload", async ({
  page,
}) => {
  const outbound = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") outbound.push(r.url());
  });
  await page.goto("/");
  await expect(page.locator("#offline-status")).toContainText(
    "オフライン準備完了",
  );
  const list = Array.from({ length: 36 }, (_, i) =>
    photo(i < 2 ? "same.jpg" : `frame-${i}.jpg`),
  );
  list.push(photo("broken.jpg", new Uint8Array([1, 2, 3])));
  await page.locator("#files").setInputFiles(list);
  await expect(page.locator("#file-count")).toHaveText("37 枚");
  await page.locator("#make").fill("Nikon");
  await page.locator("#model").fill("FM2");
  await page.locator("#lens").fill("Nikkor 50mm");
  await page.locator("#iso").fill("160");
  await page.getByRole("radio", { name: "一括入力" }).check();
  await page.locator("#batch-fields select").nth(0).selectOption("5.6");
  await page.locator("#batch-fields select").nth(1).selectOption("1/60");
  await page.locator("#process").click();
  await expect(page.locator("#result")).toContainText("成功 36 枚・失敗 1 枚");
  await expect(page.locator(".failure")).toContainText("broken.jpg");
  const files = await download(page);
  expect(files).toHaveLength(36);
  expect(new Set(files.map((f) => f.name)).size).toBe(36);
  for (const f of files) {
    const d = decode(f.data);
    expect(d.Image.Model).toBe("FM2");
    expect(d.Photo.FNumber).toBe(5.6);
    expect(d.Photo.ExposureTime).toBe(1 / 60);
    expect(d.Photo.ISOSpeedRatings).toBe(160);
  }
  expect(outbound).toEqual([]);
  await page.locator("#iso").fill("400");
  await expect(page.locator("#download")).toBeHidden();
});
test("individual exposures, independent unset fields, sorted names, default unset", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator("#files")
    .setInputFiles([photo("02.jpg"), photo("01.jpg")]);
  await expect(page.locator(".photo-name").first()).toHaveText("01.jpg");
  await page.getByRole("radio", { name: "個別入力" }).check();
  await page
    .locator(".photo")
    .nth(0)
    .locator("select")
    .nth(0)
    .selectOption("4");
  await page
    .locator(".photo")
    .nth(1)
    .locator("select")
    .nth(1)
    .selectOption("custom");
  await page
    .locator(".photo")
    .nth(1)
    .getByRole("textbox", { name: "02.jpg のシャッタースピードの任意の値" })
    .fill("1/90");
  await page.locator("#process").click();
  await expect(page.locator("#result")).toContainText("成功 2 枚");
  const files = await download(page),
    a = decode(files[0].data),
    b = decode(files[1].data);
  expect(a.Photo.FNumber).toBe(4);
  expect(a.Photo.ExposureTime).toBeUndefined();
  expect(b.Photo.FNumber).toBeUndefined();
  expect(b.Photo.ExposureTime).toBe(1 / 90);
  await page.getByRole("radio", { name: "未設定", exact: false }).check();
  await page.locator("#process").click();
  await expect(page.locator("#result")).toContainText("成功 2 枚");
  for (const f of await download(page)) {
    const d = decode(f.data);
    expect(d.Photo.FNumber).toBeUndefined();
    expect(d.Photo.ApertureValue).toBeUndefined();
    expect(d.Photo.ExposureTime).toBeUndefined();
    expect(d.Photo.ShutterSpeedValue).toBeUndefined();
  }
});
test("preset CRUD persists through reload, fully offline reload/edit/download", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.locator("#offline-status")).toContainText(
    "オフライン準備完了",
  );
  await page.locator("#make").fill("Nikon");
  await page.locator("#model").fill("FM2");
  await page.locator("#lens").fill("50mm");
  await page.locator("#preset-editor summary").click();
  await page.locator("#preset-name").fill("My FM2");
  await page.locator("#save-preset").click();
  await page.reload();
  await page.locator("#preset").selectOption({ label: "My FM2" });
  await expect(page.locator("#model")).toHaveValue("FM2");
  await page.locator("#lens").fill("35mm");
  await page.locator("#preset-editor summary").click();
  await page.locator("#update-preset").click();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#offline-status")).toContainText(
    "オフライン準備完了",
  );
  await page.locator("#preset").selectOption({ label: "My FM2" });
  await expect(page.locator("#lens")).toHaveValue("35mm");
  await page.locator("#files").setInputFiles(photo());
  await page.locator("#process").click();
  await expect(page.locator("#result")).toContainText("成功 1 枚");
  const files = await download(page);
  expect(decode(files[0].data).Photo.LensModel).toBe("35mm");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#delete-preset").click();
  await page.reload();
  await expect(page.locator("#preset option")).toHaveCount(1);
});
test("invalid ISO and exposure prevent processing; mobile layout fits viewport", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#files").setInputFiles(photo());
  await page.locator("#iso").fill("0");
  await page.locator("#process").click();
  await expect(page.locator("#message")).toContainText("ISO");
  await page.locator("#iso").fill("400");
  await page.getByRole("radio", { name: "一括入力" }).check();
  await page.locator("#batch-fields select").nth(1).selectOption("custom");
  await page.locator("#batch-fields input").nth(1).fill("1/0");
  await page.locator("#process").click();
  await expect(page.locator("#message")).toContainText("露出値");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("storage quota errors remain visible and never claim preset saved", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = function () {
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    };
  });
  await page.goto("/");
  await page.locator("#preset-editor summary").click();
  await page.locator("#preset-name").fill("FM2");
  await page.locator("#save-preset").click();
  await expect(page.locator("#message")).toContainText("保存できません");
  await expect(page.locator("#preset option")).toHaveCount(1);
});

test("help is available on demand, returns focus, and preserves editing inputs", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#make").fill("Nikon");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "ヘルプ", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("MakerNote");
  await page.getByRole("button", { name: "ヘルプを閉じる" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator("#open-help")).toBeFocused();
  await expect(page.locator("#make")).toHaveValue("Nikon");
  await page.locator("#open-help").click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("tablet workspace keeps export in view, touch controls fit, and clearing restores empty state", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator("#files")
    .setInputFiles(
      Array.from({ length: 36 }, (_, i) => photo(`frame-${i}.jpg`)),
    );
  for (const viewport of [
    { width: 810, height: 1080 },
    { width: 1080, height: 810 },
  ]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const box = (id) => document.getElementById(id).getBoundingClientRect();
      const settings = document
        .querySelector(".settings")
        .getBoundingClientRect();
      const list = document.querySelector(".workspace").getBoundingClientRect();
      const process = box("process");
      return {
        sideBySide: settings.right <= list.left,
        exportVisible: process.top >= 0 && process.bottom <= innerHeight,
        fits: document.documentElement.scrollWidth <= innerWidth,
        touch: [
          ...document.querySelectorAll(
            "#process,#open-help,.modes label,[data-iso]",
          ),
        ].every((e) => e.getBoundingClientRect().height >= 44),
      };
    });
    expect(layout).toEqual({
      sideBySide: true,
      exportVisible: true,
      fits: true,
      touch: true,
    });
  }
  await page.locator("#clear-files").click();
  await expect(page.locator("#file-count")).toHaveText("0 枚");
  await expect(page.locator("#photo-list .empty")).toBeVisible();
  await expect(page.locator("#process")).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#open-help").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator("#close-help").click();
});

test("offline setup errors remain available in touch-accessible help", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.serviceWorker.register = async () => {
      throw new Error("CACHE_TEST_ERROR");
    };
  });
  await page.goto("/");
  await expect(page.locator("#offline-status")).toHaveText(
    "オフライン準備失敗",
  );
  await page.locator("#open-help").click();
  await expect(page.getByRole("dialog")).toContainText("CACHE_TEST_ERROR");
  await expect(page.getByRole("dialog")).toContainText("接続中は利用できます");
});
