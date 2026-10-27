import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";

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
