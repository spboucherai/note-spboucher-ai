// file: scripts/contrast.mjs
// description: reads the colour tokens of src/app/globals.css (oklch sources of truth), converts them to sRGB hex (the values the
//   native SPNotesDesign module must match) and checks the WCAG 2.2 contrast of every text/background pair in both themes.
// author: Simon-Pierre Boucher — contact@spboucher.ai
// usage: node scripts/contrast.mjs [--json]   (exit code 1 when a required pair is under its threshold)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/app/globals.css"), "utf8");

/** oklch(L% C H [/ a]) → linear sRGB (Björn Ottosson's OKLab matrices). */
export function oklchToLinear(L, C, H) {
  const h = (H * Math.PI) / 180; const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b, m_ = L - 0.1055613458 * a - 0.0638541728 * b, s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
const gamma = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
/** Out-of-gamut colours are clipped per channel, which is what browsers do when they paint oklch() on an sRGB display (verified against Chromium in tests/e2e/next-web.spec.ts). */
export function oklchToSrgb(L, C, H) { return oklchToLinear(L, C, H).map((v) => clamp01(gamma(clamp01(v)))); }
export const hex = (rgb) => "#" + rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
const lum = (rgb) => { const [r, g, b] = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };

function tokens(block) {
  const out = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)\s*;/g)) out[m[1]] = oklchToSrgb(Number(m[2]) / 100, Number(m[3]), Number(m[4]));
  return out;
}
/** Every top-level `selector { … }` block, concatenated (the scales and the colours live in separate :root blocks). */
const grab = (selector) => { let out = "", i = -1; while ((i = css.indexOf(`\n${selector} {`, i + 1)) >= 0) out += css.slice(i, css.indexOf("\n}", i)); if (!out) throw new Error(`block ${selector} not found`); return out; };
const themes = { light: tokens(grab(":root")), dark: tokens(grab(".dark")) };

// [foreground, background, minimum ratio, what it is used for]
const PAIRS = [
  ["fg", "bg", 4.5, "body text"], ["fg", "bg-elev", 4.5, "text on cards"], ["fg", "bg-sunk", 4.5, "text on sunken surfaces"], ["fg", "bg-side", 4.5, "sidebar text (active)"], ["fg", "bg-hover", 4.5, "hovered row"],
  ["fg-muted", "bg", 4.5, "secondary text"], ["fg-muted", "bg-elev", 4.5, "secondary text on cards"], ["fg-muted", "bg-side", 4.5, "sidebar items"], ["fg-muted", "bg-sunk", 4.5, "secondary text on sunken"], ["fg-muted", "bg-hover", 4.5, "secondary text on hover"],
  ["fg-faint", "bg", 3, "placeholders / decorative labels (large or non-essential: AA 3:1)"], ["fg-faint", "bg-side", 3, "sidebar section labels"],
  ["accent", "bg", 4.5, "links"], ["accent", "bg-elev", 4.5, "links on cards"], ["accent", "accent-soft", 4.5, "accent text on its soft chip"], ["accent-fg", "accent", 4.5, "primary button label"],
  ["ai", "bg", 4.5, "AI text"], ["ai", "ai-soft", 4.5, "AI text on its soft surface"], ["ai", "bg-elev", 4.5, "AI text on cards"],
  ["danger", "bg", 4.5, "error text"], ["success", "bg", 3, "success icons / large text"], ["warning", "bg", 0, "warning hue — informational: paired with a text label in fg, never used alone as text"],
  // SPEC §7: small semantic text uses the *-text variants (darker in light mode, the base hue in dark mode)
  ["success-text", "bg", 4.5, "small success text"], ["success-text", "bg-elev", 4.5, "small success text on cards"], ["success-text", "bg-sunk", 4.5, "small success text on sunken surfaces"],
  ["warning-text", "bg", 4.5, "small warning text"], ["warning-text", "bg-elev", 4.5, "small warning text on cards"], ["warning-text", "bg-sunk", 4.5, "small warning text on sunken surfaces"],
  ["danger-text", "bg", 4.5, "small error text"], ["danger-text", "bg-elev", 4.5, "small error text on cards"], ["danger-text", "bg-sunk", 4.5, "small error text on sunken surfaces"],
  ["focus", "bg", 3, "focus ring (non-text: 3:1)"], ["focus", "bg-elev", 3, "focus ring on cards"], ["focus", "bg-side", 3, "focus ring in the sidebar"],
  ["line-strong", "bg", 0, "decorative separators — informational"],
];
const rows = []; let failed = 0;
for (const [name, t] of Object.entries(themes)) for (const [fg, bg, min, use] of PAIRS) {
  if (!t[fg] || !t[bg]) { rows.push({ theme: name, fg, bg, ratio: null, min, ok: false, use: "TOKEN MISSING" }); failed++; continue; }
  const ratio = contrast(t[fg], t[bg]); const ok = ratio >= min; if (!ok) failed++;
  rows.push({ theme: name, fg, bg, fgHex: hex(t[fg]), bgHex: hex(t[bg]), ratio: Math.round(ratio * 100) / 100, min, ok, use });
}
const hexes = Object.fromEntries(Object.entries(themes).map(([n, t]) => [n, Object.fromEntries(Object.entries(t).map(([k, v]) => [k, hex(v)]))]));
if (process.argv.includes("--json")) console.log(JSON.stringify({ hexes, rows }, null, 1));
else {
  console.log("sRGB conversion of the oklch tokens\n" + ["token".padEnd(14) + "light    dark", ...Object.keys(hexes.light).map((k) => k.padEnd(14) + hexes.light[k] + "  " + (hexes.dark[k] ?? ""))].join("\n"));
  console.log("\nWCAG contrast\n" + rows.map((r) => `${r.min === 0 ? "info" : r.ok ? "ok  " : "FAIL"} ${r.theme.padEnd(5)} ${(r.fg + " / " + r.bg).padEnd(26)} ${String(r.ratio).padStart(5)} (min ${r.min})  ${r.use}`).join("\n"));
  console.log(failed ? `\n${failed} pair(s) under the threshold` : "\nAll pairs pass.");
}
process.exitCode = failed ? 1 : 0;
