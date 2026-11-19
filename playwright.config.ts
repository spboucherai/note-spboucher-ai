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
  reporter: [["list"]], globalSetup: "./tests/e2e/global-setup.ts", globalTeardown: "./tests/e2e/global-teardown.ts",
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
    // SP Note Next Generation — Infinite Canvas (clipboard for copy / paste of cards)
    { name: "next-canvas", testMatch: /next-canvas\.spec\.ts/, use: { viewport: { width: 1280, height: 800 }, permissions: ["clipboard-read", "clipboard-write"] }, dependencies: ["auth"] },
    { name: "next-canvas-phone-360", testMatch: /next-canvas-phones\.spec\.ts/, use: phone(360, 740), dependencies: ["auth"] },
    { name: "next-canvas-phone-375", testMatch: /next-canvas-phones\.spec\.ts/, use: phone(375, 667), dependencies: ["auth"] },
    { name: "next-canvas-phone-430", testMatch: /next-canvas-phones\.spec\.ts/, use: phone(430, 932), dependencies: ["auth"] },
    // SP Note Next Generation — productivity workstream: web offline-first (service worker + device replica; real offline via context.setOffline)
    { name: "next-p-offline", testMatch: /next-p-offline\.spec\.ts/, use: { viewport: { width: 1280, height: 800 }, serviceWorkers: "allow" }, dependencies: ["auth"] },
    { name: "next-p-offline-phone-360", testMatch: /next-p-offline-phones\.spec\.ts/, use: phone(360, 740), dependencies: ["auth"] },
    { name: "next-p-offline-phone-375", testMatch: /next-p-offline-phones\.spec\.ts/, use: phone(375, 667), dependencies: ["auth"] },
    { name: "next-p-offline-phone-430", testMatch: /next-p-offline-phones\.spec\.ts/, use: phone(430, 932), dependencies: ["auth"] },
    // slice next-p-ra — research workspace, contextual AI, living blocks, import/export + UI defect fixes
    { name: "next-p-ra", testMatch: /next-p-ra(-ui)?\.spec\.ts/, use: { viewport: { width: 1280, height: 800 }, permissions: ["clipboard-read", "clipboard-write"] }, dependencies: ["auth"] },
    // SP Note Next Generation — capture, Smart Inbox and voice notes (fake microphone for the recorder with pause/resume)
    { name: "next-p-cv", testMatch: /next-p-cv\.spec\.ts/, use: { viewport: { width: 1280, height: 800 }, permissions: ["clipboard-read", "clipboard-write", "microphone"], launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } }, dependencies: ["auth"] },
    { name: "next-p-cv-phone-360", testMatch: /next-p-cv-phones\.spec\.ts/, use: phone(360, 740), dependencies: ["auth"] },
    { name: "next-p-cv-phone-375", testMatch: /next-p-cv-phones\.spec\.ts/, use: phone(375, 667), dependencies: ["auth"] },
    { name: "next-p-cv-phone-430", testMatch: /next-p-cv-phones\.spec\.ts/, use: phone(430, 932), dependencies: ["auth"] },
    // SP Note Next Generation — databases (productivity workstream)
    { name: "next-p-db", testMatch: /next-p-db\.spec\.ts/, use: { viewport: { width: 1280, height: 800 } }, dependencies: ["auth"] },
    { name: "next-p-db-phone-360", testMatch: /next-p-db-phones\.spec\.ts/, use: phone(360, 740), dependencies: ["auth"] },
    { name: "next-p-db-phone-375", testMatch: /next-p-db-phones\.spec\.ts/, use: phone(375, 667), dependencies: ["auth"] },
    { name: "next-p-db-phone-430", testMatch: /next-p-db-phones\.spec\.ts/, use: phone(430, 932), dependencies: ["auth"] },
    // NEXT-K ▼ knowledge screens (graph 2.0, constellation, timeline, time machine, health, brief, zoom, ask)
    { name: "next-k-desktop", testMatch: /next-k\.spec\.ts/, use: { viewport: { width: 1280, height: 800 } }, dependencies: ["auth"] },
    { name: "next-k-phone-360", testMatch: /next-k-phones\.spec\.ts/, use: phone(360, 740), dependencies: ["auth"] },
    { name: "next-k-phone-375", testMatch: /next-k-phones\.spec\.ts/, use: phone(375, 667), dependencies: ["auth"] },
    { name: "next-k-phone-430", testMatch: /next-k-phones\.spec\.ts/, use: phone(430, 932), dependencies: ["auth"] },
    // NEXT-K ▲
    // integration hardening: one cross-feature scenario on the merged build (service worker for the offline leg)
    { name: "next-integration", testMatch: /next-integration\.spec\.ts/, use: { viewport: { width: 1280, height: 800 }, serviceWorkers: "allow", permissions: ["clipboard-read", "clipboard-write"] }, dependencies: ["auth"] },
  ],
});
