import { defineConfig } from "@playwright/test";
import "dotenv/config";
/**
 * End-to-end checks against a running build (default http://localhost:8481, database *_dev — never production).
 * Chromium only: the WebAuthn virtual authenticator is a Chrome DevTools feature. Phone projects emulate viewport, touch and user agent;
 * they do not replace a pass on a real iPhone (keyboard, Face ID sheet, safe areas) — see docs/testing.md.
 */
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const phone = (width: number, height: number) => ({ viewport: { width, height }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
export default defineConfig({
  testDir: "./tests/e2e", outputDir: "./test-results", fullyParallel: false, workers: 1, retries: 0, timeout: 60_000,
  reporter: [["list"]], globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8481", storageState: "test-results/.auth/state.json", trace: "retain-on-failure", screenshot: "only-on-failure", locale: "en-CA", timezoneId: "America/Toronto" },
  projects: [
    { name: "auth", testMatch: /auth\.spec\.ts/, use: { ...phone(390, 844), storageState: { cookies: [], origins: [] } } },
    { name: "phone-360", testMatch: /mobile.*\.spec\.ts/, use: phone(360, 740), dependencies: ["auth"] },
    { name: "iphone-se", testMatch: /mobile.*\.spec\.ts/, use: phone(375, 667), dependencies: ["auth"] },
    { name: "iphone-max", testMatch: /mobile.*\.spec\.ts/, use: phone(430, 932), dependencies: ["auth"] },
    { name: "desktop", testMatch: /desktop.*\.spec\.ts/, use: { viewport: { width: 1280, height: 800 } }, dependencies: ["auth"] },
    // SP Note Next Generation — web editor / design system (fake microphone for the voice-note recorder; clipboard for Markdown paste)
    { name: "next-desktop", testMatch: /next-web\.spec\.ts/, use: { viewport: { width: 1280, height: 800 }, permissions: ["clipboard-read", "clipboard-write", "microphone"], launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } }, dependencies: ["auth"] },
    { name: "next-phone-360", testMatch: /next-web-phones\.spec\.ts/, use: phone(360, 740), dependencies: ["auth"] },
    { name: "next-phone-375", testMatch: /next-web-phones\.spec\.ts/, use: phone(375, 667), dependencies: ["auth"] },
    { name: "next-phone-430", testMatch: /next-web-phones\.spec\.ts/, use: phone(430, 932), dependencies: ["auth"] },
    // SP Note Next Generation — capture, Smart Inbox and voice notes (fake microphone for the recorder with pause/resume)
    { name: "next-p-cv", testMatch: /next-p-cv\.spec\.ts/, use: { viewport: { width: 1280, height: 800 }, permissions: ["clipboard-read", "clipboard-write", "microphone"], launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } }, dependencies: ["auth"] },
    { name: "next-p-cv-phone-360", testMatch: /next-p-cv-phones\.spec\.ts/, use: phone(360, 740), dependencies: ["auth"] },
    { name: "next-p-cv-phone-375", testMatch: /next-p-cv-phones\.spec\.ts/, use: phone(375, 667), dependencies: ["auth"] },
    { name: "next-p-cv-phone-430", testMatch: /next-p-cv-phones\.spec\.ts/, use: phone(430, 932), dependencies: ["auth"] },
  ],
});
