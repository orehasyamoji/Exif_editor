import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
const chromiumPath =
  process.env.CHROMIUM_PATH ||
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 2,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    serviceWorkers: "allow",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build && npm run preview -- --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "chromium-ipad",
      use: {
        ...devices["iPad (gen 7)"],
        defaultBrowserType: "chromium",
        launchOptions: { executablePath: chromiumPath, args: ["--no-sandbox"] },
      },
    },
    { name: "webkit-ipad", use: { ...devices["iPad (gen 7)"] } },
  ],
});
