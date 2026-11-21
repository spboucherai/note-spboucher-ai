/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/canvas/export.ts
 * Description      : what a canvas becomes outside the canvas — its plain text
 *                    (search index of the canvas page), a Markdown outline
 *                    (cards + connections) and a standalone SVG drawing (also
 *                    the source of the PNG export, rasterised in the browser).
 *                    Pure: images and ink are passed in already resolved, so
 *                    the same code runs on the server, in the browser and in a
 *                    unit test.
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-19
 * Last Modified    : 2026-11-19
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: contact@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

import type { CanvasData, CanvasNode } from "./format";
import { backToFront, contentBounds, nodeLabel, parseTable, rectOf, type Rect } from "./core";
import { arrowHead, hasArrow, routeEdge, routeStyleOf } from "./routing";

export type TitleLookup = (id: string) => string | undefined;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const KIND_NAME: Record<string, string> = { text: "Text", page: "Page", image: "Image", pdf: "PDF", link: "Link", drawing: "Drawing", shape: "Shape", reference: "Reference", math: "Formula", table: "Table" };

/**
 * Plain text of a canvas, for the full-text and semantic index of its page: per node, in array order, its `text`, `latex` and `url`
 * (each when present, one per line; a table's Markdown syntax is reduced to its cells), then the labels of the edges. No Markdown is
 * interpreted otherwise. Capped at 200 000 characters.
 */
export function canvasText(d: CanvasData): string {
  const out: string[] = [];
  for (const n of d.nodes) {
    const text = n.kind === "table" ? parseTable(str(n.text)).map((r) => r.filter(Boolean).join(" ")).filter(Boolean).join("\n") : str(n.text).trim();
    for (const part of [text, str(n.latex).trim(), str(n.url).trim()]) if (part) out.push(part);
  }
  for (const e of d.edges) { const l = str(e.label).trim(); if (l) out.push(l); }
  return out.join("\n").slice(0, 200_000);
}

/** Markdown outline: a title, the cards in array order (the order of the outline / list mode) and the connections. */
export function canvasToMarkdown(d: CanvasData, title: string, titles?: TitleLookup): string {
  const esc = (s: string) => s.replace(/([\\[\]])/g, "\\$1");
  const lines: string[] = [`# ${title.trim() || "Untitled canvas"}`, "", "## Cards", ""];
  if (!d.nodes.length) lines.push("_No card._");
  for (const n of d.nodes) {
    const kind = KIND_NAME[n.kind] ?? `Card (${n.kind})`; const label = nodeLabel(n, titles); let body: string;
    switch (n.kind) {
      case "page": body = typeof n.pageId === "string" ? `[${esc(label)}](/p/${n.pageId})` : label; break;
      case "link": body = str(n.url) ? `[${esc(label)}](${str(n.url)})` : label; break;
      case "image": body = typeof n.attachmentId === "string" ? `![${esc(label)}](/api/files/${n.attachmentId})` : label; break;
      case "pdf": body = typeof n.attachmentId === "string" ? `[${esc(label)}](/api/files/${n.attachmentId})` : label; break;
      case "math": body = str(n.latex).trim() ? `$${str(n.latex).trim()}$` : label; break;
      default: body = label;
    }
    lines.push(`- **${kind}** — ${body}`);
    if (n.kind === "table") for (const row of str(n.text).split("\n")) { if (row.trim()) lines.push(`  ${row.trim()}`); }
    else if (n.kind === "text" || n.kind === "shape") { const rest = str(n.text).split("\n").map((l) => l.trimEnd()); const i = rest.findIndex((l) => l.trim()); for (const l of rest.slice(i + 1)) if (l.trim()) lines.push(`  ${l}`); }
  }
  lines.push("", "## Connections", "");
  const byId = new Map(d.nodes.map((n) => [n.id, n])); const edges = d.edges.filter((e) => byId.has(e.from) && byId.has(e.to));
  if (!edges.length) lines.push("_No connection._");
  for (const e of edges) lines.push(`- ${nodeLabel(byId.get(e.from)!, titles)} ${hasArrow(e) ? "→" : "—"} ${nodeLabel(byId.get(e.to)!, titles)}${str(e.label).trim() ? ` — ${str(e.label).trim()}` : ""}`);
  return lines.join("\n") + "\n";
}

export interface SvgTheme { bg: string; card: string; fg: string; muted: string; line: string; accent: string }
export const SVG_LIGHT: SvgTheme = { bg: "#f9fbfd", card: "#ffffff", fg: "#151922", muted: "#535862", line: "#ccd0d5", accent: "#2f5ddb" };
export const SVG_DARK: SvgTheme = { bg: "#0d1016", card: "#15181f", fg: "#e8ebef", muted: "#a0a5ae", line: "#333640", accent: "#7ca5ff" };
export interface SvgOptions {
  theme?: SvgTheme; padding?: number; titles?: TitleLookup;
  /** attachment id → data: URL (images, PDF thumbnails) */ images?: ReadonlyMap<string, string>;
  /** ink attachment id → strokes in ink units + the ink's own width / height */ inks?: ReadonlyMap<string, { width: number; height: number; strokes: { color: string; width: number; points: number[][] }[] }>;
  /** Only this region (world units); default = the bounds of the content. */ region?: Rect;
}
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const HEX = /^#[0-9a-f]{6}$/i;
/** Greedy word wrap for the SVG export (no text measurement available): average glyph width = 0.55 × font size. */
export function wrapText(text: string, width: number, fontSize: number, maxLines: number): string[] {
  const perLine = Math.max(4, Math.floor(width / (fontSize * 0.55))); const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (w.length > perLine) { if (line) { out.push(line); line = ""; } out.push(w.slice(0, perLine)); w = w.slice(perLine); }
      if (!line) line = w; else if (line.length + 1 + w.length <= perLine) line += ` ${w}`; else { out.push(line); line = w; }
    }
    out.push(line);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  if (out.length > maxLines) { const cut = out.slice(0, Math.max(1, maxLines)); cut[cut.length - 1] = `${cut[cut.length - 1].slice(0, Math.max(1, perLine - 1))}…`; return cut; }
  return out;
}

/** A standalone SVG of the canvas (world units = SVG user units). Cards are drawn back to front, connections under the cards. */
export function canvasToSvg(d: CanvasData, opts: SvgOptions = {}): string {
  const t = opts.theme ?? SVG_LIGHT, pad = opts.padding ?? 32;
  const b = opts.region ?? contentBounds(d) ?? { x: 0, y: 0, w: 320, h: 200 };
  const vb = { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" width="${vb.w}" height="${vb.h}" font-family="Inter, system-ui, sans-serif">`, `<rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="${t.bg}"/>`];
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  for (const e of d.edges) {
    const a = byId.get(e.from), c = byId.get(e.to); if (!a || !c) continue;
    const r = routeEdge(a, c, routeStyleOf(e)); const color = HEX.test(str(e.color)) ? str(e.color) : t.muted;
    out.push(`<path d="${r.d}" fill="none" stroke="${color}" stroke-width="1.5"/>`);
    if (hasArrow(e)) out.push(`<polygon points="${arrowHead(r.points[r.points.length - 1], r.endAngle).map((p) => `${p.x},${p.y}`).join(" ")}" fill="${color}"/>`);
    const label = str(e.label).trim();
    if (label) { const w = Math.min(240, label.length * 6.6 + 12); out.push(`<rect x="${r.label.x - w / 2}" y="${r.label.y - 10}" width="${w}" height="20" rx="6" fill="${t.bg}"/>`, `<text x="${r.label.x}" y="${r.label.y + 4}" font-size="12" text-anchor="middle" fill="${t.muted}">${xml(label.slice(0, 36))}</text>`); }
  }
  for (const n of backToFront(d)) out.push(nodeSvg(n, t, opts));
  out.push("</svg>");
  return out.join("\n");
}
function nodeSvg(n: CanvasNode, t: SvgTheme, o: SvgOptions): string {
  const r = rectOf(n); const color = HEX.test(str(n.color)) ? str(n.color) : null; const stroke = color ?? t.line; const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const fill = color ? `${color}22` : t.card; const parts: string[] = [];
  const textBlock = (text: string, opts: { size?: number; center?: boolean; top?: number; fill?: string; weight?: number } = {}) => {
    const size = opts.size ?? 13, lh = size * 1.4; const lines = wrapText(text, r.w - 24, size, Math.max(1, Math.floor((r.h - (opts.top ?? 12) - 8) / lh)));
    const y0 = opts.center ? cy - ((lines.length - 1) * lh) / 2 + size * 0.35 : r.y + (opts.top ?? 12) + size;
    return lines.map((l, i) => `<text x="${opts.center ? cx : r.x + 12}" y="${y0 + i * lh}" font-size="${size}" ${opts.weight ? `font-weight="${opts.weight}" ` : ""}${opts.center ? 'text-anchor="middle" ' : ""}fill="${opts.fill ?? t.fg}">${xml(l)}</text>`).join("");
  };
  const card = `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="10" fill="${fill}" stroke="${stroke}"/>`;
  const label = nodeLabel(n, o.titles);
  switch (n.kind) {
    case "shape":
      if (n.shape === "ellipse") parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="${r.w / 2}" ry="${r.h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`);
      else if (n.shape === "diamond") parts.push(`<polygon points="${cx},${r.y} ${r.x + r.w},${cy} ${cx},${r.y + r.h} ${r.x},${cy}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`);
      else parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`);
      if (str(n.text).trim()) parts.push(textBlock(str(n.text), { center: true }));
      break;
    case "image": case "pdf": {
      const src = typeof n.attachmentId === "string" ? o.images?.get(n.attachmentId) : undefined;
      parts.push(card);
      if (src) parts.push(`<image href="${xml(src)}" x="${r.x + 1}" y="${r.y + 1}" width="${Math.max(0, r.w - 2)}" height="${Math.max(0, r.h - 2)}" preserveAspectRatio="xMidYMid ${n.kind === "pdf" ? "meet" : "slice"}"/>`);
      else parts.push(textBlock(`${n.kind === "pdf" ? "PDF" : "Image"} · ${label}`, { center: true, fill: t.muted }));
      break;
    }
    case "drawing": {
      const ink = typeof n.ink === "string" ? o.inks?.get(n.ink) : undefined;
      if (!ink) { parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="10" fill="none" stroke="${t.line}" stroke-dasharray="4 4"/>`, textBlock("Drawing", { center: true, fill: t.muted })); break; }
      const sx = ink.width > 0 ? r.w / ink.width : 1, sy = ink.height > 0 ? r.h / ink.height : 1;
      for (const s of ink.strokes) { const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s.color); parts.push(`<polyline points="${s.points.map((p) => `${Math.round((r.x + p[0] * sx) * 100) / 100},${Math.round((r.y + p[1] * sy) * 100) / 100}`).join(" ")}" fill="none" stroke="#${m ? m[1] : "64748b"}" stroke-opacity="${m && m[2] ? Math.round((parseInt(m[2], 16) / 255) * 100) / 100 : 1}" stroke-width="${Math.max(0.5, s.width * Math.min(sx, sy))}" stroke-linecap="round" stroke-linejoin="round"/>`); }
      break;
    }
    case "table": {
      const cells = parseTable(str(n.text)); parts.push(card);
      const rows = cells.length || 1, cols = cells[0]?.length || 1, cw = r.w / cols, rh = r.h / rows;
      for (let i = 1; i < rows; i++) parts.push(`<line x1="${r.x}" y1="${r.y + i * rh}" x2="${r.x + r.w}" y2="${r.y + i * rh}" stroke="${t.line}"/>`);
      for (let j = 1; j < cols; j++) parts.push(`<line x1="${r.x + j * cw}" y1="${r.y}" x2="${r.x + j * cw}" y2="${r.y + r.h}" stroke="${t.line}"/>`);
      cells.forEach((row, i) => row.forEach((c, j) => { if (c) parts.push(`<text x="${r.x + j * cw + 6}" y="${r.y + i * rh + Math.min(rh / 2 + 4, 16)}" font-size="11" ${i === 0 ? 'font-weight="600" ' : ""}fill="${t.fg}">${xml(c.replace(/\n/g, " ").slice(0, Math.max(2, Math.floor(cw / 6.2))))}</text>`); }));
      break;
    }
    case "math": parts.push(card, textBlock(str(n.latex) || label, { center: true })); break;
    case "page": case "reference": case "link": {
      parts.push(card, `<text x="${r.x + 12}" y="${r.y + 18}" font-size="10" font-weight="600" letter-spacing=".06em" fill="${n.kind === "page" ? t.accent : t.muted}">${(KIND_NAME[n.kind] ?? "").toUpperCase()}</text>`, textBlock(label, { top: 24, weight: 600 }));
      if (n.kind === "link" && str(n.url) && str(n.url) !== label) parts.push(`<text x="${r.x + 12}" y="${r.y + r.h - 10}" font-size="11" fill="${t.muted}">${xml(str(n.url).slice(0, Math.max(4, Math.floor((r.w - 24) / 6))))}</text>`);
      break;
    }
    case "text": parts.push(card, textBlock(str(n.text) || "")); break;
    default: parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="10" fill="${t.card}" stroke="${t.line}" stroke-dasharray="4 4"/>`, textBlock(label, { center: true, fill: t.muted }));
  }
  return `<g data-id="${xml(n.id)}">${parts.join("")}</g>`;
}
