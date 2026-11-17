/**
 * Structured logs (pino JSON on stdout → PM2 logs). Rule: identifiers and timings only.
 * Never log note text, excerpts, prompts, upload contents, cookies, session tokens, API keys or WebAuthn assertions.
 * The redact list is a safety net for objects passed by mistake.
 */
import pino from "pino";
export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { app: "note" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: ["token", "cookie", "authorization", "password", "apiKey", "content", "text", "prompt", "response", "assertion", "*.token", "*.cookie", "*.authorization", "*.password", "*.apiKey", "*.content", "*.text", "*.prompt", "*.assertion"], censor: "[redacted]" },
});
export const newRequestId = () => crypto.randomUUID();
