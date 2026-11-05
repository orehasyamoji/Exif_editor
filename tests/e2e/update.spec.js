import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fixture } from "../fixture.js";

test("update uses matching build HTML despite stale server HTML and retains previous assets offline", async ({
  page,
  context,
}) => {
  const root = resolve("dist");
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/" || path === "/index.html") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        "<!doctype html><title>Old CDN HTML</title><p>stale deployment document</p>",
      );
      return;
    }
    try {
      const data = await readFile(resolve(root, "." + path));
      res.setHeader(
        "Content-Type",
        {
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".webmanifest": "application/manifest+json",
        }[extname(path)] || "application/octet-stream",
      );
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    await page.goto(url);
    await expect(page).toHaveTitle("Old CDN HTML");
    await page.evaluate(async () => {
      const c = await caches.open(
        "film-exif:" + location.origin + "/:previous",
      );
      await c.put(
        "./assets/retired.css",
        new Response("/* previous build */", {
          headers: { "Content-Type": "text/css" },
        }),
      );
      await navigator.serviceWorker.register("./sw.js");
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect(page.locator("#offline-status")).toHaveText(
      "オフライン準備完了",
    );
    await expect(page.locator("#open-help")).toBeVisible();
    expect(
      await page
        .locator("#editor")
        .evaluate((e) => getComputedStyle(e).display),
    ).toBe("grid");
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator("#offline-status")).toHaveText(
      "オフライン準備完了",
    );
    expect(
      await page
        .locator("#editor")
        .evaluate((e) => getComputedStyle(e).display),
    ).toBe("grid");
    expect(
      await page.evaluate(() =>
        fetch("./assets/retired.css").then((r) => r.text()),
      ),
    ).toBe("/* previous build */");
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("evicted HTML cache still loads offline with presets and functional export", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.locator("#offline-status")).toContainText("準備完了");
  await page.evaluate(async () => {
    localStorage.setItem("recovery-test", "preserve");
    localStorage.setItem(
      "film-exif-presets-v1",
      JSON.stringify([
        {
          id: "recover",
          name: "復旧テスト",
          make: "Nikon",
          model: "FM2",
          lens: "50mm",
        },
      ]),
    );
    for (const key of await caches.keys()) {
      const cache = await caches.open(key);
      for (const req of await cache.keys())
        if (
          new URL(req.url).pathname.endsWith("/index.html") ||
          new URL(req.url).pathname === "/"
        )
          await cache.delete(req);
    }
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#open-help")).toBeVisible();
  expect(
    await page.locator("#editor").evaluate((e) => getComputedStyle(e).display),
  ).toBe("grid");
  expect(await page.evaluate(() => localStorage.getItem("recovery-test"))).toBe(
    "preserve",
  );
  await page.locator("#preset").selectOption({ label: "復旧テスト" });
  await expect(page.locator("#model-value")).toHaveText("FM2");
  await page
    .locator("#files")
    .setInputFiles({
      name: "recovered.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from(fixture()),
    });
  await page.locator("#process").click();
  await expect(page.locator("#result")).toContainText("成功 1 枚");
  await expect(page.locator("#download")).toBeVisible();
});

test("complete cache eviction recovers online then works offline without clearing presets", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.locator("#offline-status")).toContainText("準備完了");
  await page.evaluate(async () => {
    localStorage.setItem("recovery-test", "preserve");
    localStorage.setItem(
      "film-exif-presets-v1",
      JSON.stringify([
        {
          id: "recover",
          name: "復旧テスト",
          make: "Nikon",
          model: "FM2",
          lens: "50mm",
        },
      ]),
    );
    await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
  });
  await page.reload();
  await expect(page.locator("#open-help")).toBeVisible();
  expect(
    await page.locator("#editor").evaluate((e) => getComputedStyle(e).display),
  ).toBe("grid");
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#open-help")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("recovery-test"))).toBe(
    "preserve",
  );
});

test("complete cache loss while offline shows recovery guidance instead of a null response", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.locator("#offline-status")).toContainText("準備完了");
  await page.evaluate(async () =>
    Promise.all((await caches.keys()).map((key) => caches.delete(key))),
  );
  await context.setOffline(true);
  const response = await page.reload();
  expect(response.status()).toBe(503);
  await expect(
    page.getByRole("button", { name: "再読み込み", exact: true }),
  ).toBeVisible();
  await expect(page.locator("body")).toContainText(
    "保存済みプリセットを削除する必要はありません",
  );
  await context.setOffline(false);
  await page.getByRole("button", { name: "再読み込み", exact: true }).click();
  await expect(page.locator("#open-help")).toBeVisible();
});
