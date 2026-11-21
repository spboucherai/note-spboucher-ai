/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/import/zip.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
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

/**
 * ZIP of Markdown (plain, Obsidian, our own export) or a Notion "Markdown & CSV" export → page tree.
 * Rules: folders mirror parents (`Foo.md` + `Foo/` → children of Foo); Notion `Name <32hex>` suffixes stripped; `Name.csv` → database
 * (`Name_all.csv` preferred, the filtered copy skipped) with `Name/<row title>.md` as row bodies; other files become attachments
 * when referenced; `references.bib` → references; `workspace.json` / `export-report.json` are ignored (metadata only).
 *
 * Safety: the central directory is validated before anything is inflated (validate.ts: entry cap, size caps, ratio, unsafe paths) and every
 * member is read through a counting stream that stops as soon as it exceeds its declared size. Members are never written to their own path.
 * Reliability: every created item has a ledger key (`zip:<path>`), so a retried job continues where it stopped; with duplicates = "skip" a
 * page whose title + text already exists is not created again and its children are attached to the existing page.
 */
import path from "node:path";
import JSZip from "jszip";
import { createAttachment, createPage, findDuplicatePage, mimeOf, tick, updatePage, ImportError, type ImportCtx, type Page } from "./pages";
import { importMarkdown, mdToDoc, parseFrontMatter, parseNotionHeader, previewText, readMarkdown } from "./markdown";
import { importCsv, parseCsv } from "./csv";
import { importBibtexRefs, parseBibtexSafe } from "./bibtex";
import { LIMITS, unsafeZipPath, validateZip } from "./validate";

const NOTION_ID = /\s+[0-9a-f]{32}(?=(\.[a-z0-9]+)?$)/i;
const stripId = (seg: string) => seg.replace(NOTION_ID, "");
const normSeg = (s: string) => stripId(s).normalize("NFC").trim();
export const normPath = (p: string) => p.split("/").filter(Boolean).map(normSeg).join("/");
export const noExt = (p: string) => p.replace(/\.[^./]+$/, "");
export const dirOf = (key: string) => (path.posix.dirname(key) === "." ? "" : path.posix.dirname(key));
const isNotionExport = (names: string[]) => names.some((n) => NOTION_ID.test(path.posix.basename(n)));
const META = /^(workspace|export-report)\.json$/;
const HIDDEN = new Set([".obsidian", ".trash", ".git", "__MACOSX"]);

export interface ZEntry { raw: string; norm: string; file: JSZip.JSZipObject; size: number }
export interface ZipPlan {
  notion: boolean; obsidian: boolean; ownExport: boolean; strip: string;
  /** Markdown files, shallow first */ md: ZEntry[]; /** database key (path without extension) → its CSV */ csvKeys: Map<string, ZEntry>;
  bibs: ZEntry[]; /** everything else: attachments when a page refers to them */ others: ZEntry[];
  /** members that are never imported (app settings folders, metadata, symlinks) */ ignored: string[];
  files: number; totalUncompressed: number;
}
/** Reads one member, refusing to inflate beyond its declared size (a lying central directory cannot blow the memory). */
export function readEntry(e: ZEntry): Promise<Buffer> {
  const limit = Math.min(LIMITS.zipEntry, e.size) + 1024;
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []; let n = 0; let failed = false;
    const s = e.file.nodeStream("nodebuffer") as NodeJS.ReadableStream & { destroy?: () => void };
    s.on("data", (c: Buffer) => { if (failed) return; n += c.length; if (n > limit) { failed = true; s.destroy?.(); reject(new ImportError(`The archive was refused: “${path.posix.basename(e.norm)}” expands beyond its declared size.`, 413, "zip_bomb")); } else chunks.push(c); });
    s.on("end", () => { if (!failed) resolve(Buffer.concat(chunks)); });
    s.on("error", (err: Error) => { if (!failed) reject(new ImportError(`The archive is damaged: “${path.posix.basename(e.norm)}” cannot be read (${String(err.message).slice(0, 100)}).`, 400, "bad_zip")); });
  });
}
export const readText = async (e: ZEntry) => (await readEntry(e)).toString("utf8");

/** Validates the archive, then classifies its members. Nothing is inflated here. */
export async function openZip(buf: Buffer): Promise<ZipPlan> {
  const facts = validateZip(buf);
  const sizes = new Map(facts.entries.map((e) => [e.name, e]));
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(buf); } catch (e) { throw new ImportError(`Not a readable ZIP archive (${String((e as Error).message).slice(0, 120)}).`, 415, "bad_zip"); }
  const entries: ZEntry[] = []; const ignored: string[] = []; let obsidian = false;
  zip.forEach((rel, f) => {
    if (f.dir) return;
    const info = sizes.get(rel) ?? sizes.get(f.name);
    if (unsafeZipPath(rel) || info?.symlink) { ignored.push(rel); return; }
    const parts = rel.split("/");
    if (parts.some((p) => p === ".DS_Store" || p.startsWith("._") || p === "__MACOSX")) return;
    if (parts.includes(".obsidian")) obsidian = true;
    if (parts.some((p) => HIDDEN.has(p))) { ignored.push(rel); return; }
    entries.push({ raw: rel, norm: normPath(rel), file: f, size: info?.uncompressedSize ?? LIMITS.zipEntry });
  });
  entries.sort((a, b) => a.norm.localeCompare(b.norm));
  const notion = isNotionExport(entries.map((e) => e.raw));
  // Strip a single common top-level folder (Notion exports and `zip -r folder` both produce one)
  const tops = new Set(entries.map((e) => e.norm.split("/")[0]));
  const strip = tops.size === 1 && entries.length > 0 && entries.every((e) => e.norm.includes("/")) ? `${[...tops][0]}/` : "";
  for (const e of entries) e.norm = e.norm.slice(strip.length);
  const meta = entries.filter((e) => META.test(e.norm));
  const md = entries.filter((e) => /\.(md|markdown)$/i.test(e.norm));
  const csvs = entries.filter((e) => /\.csv$/i.test(e.norm));
  const bibs = entries.filter((e) => /\.bib$/i.test(e.norm));
  const taken = new Set<ZEntry>([...md, ...csvs, ...bibs, ...meta]);
  const others = entries.filter((e) => !taken.has(e));
  // Notion: prefer `_all.csv`, skip the filtered twin
  const csvKeys = new Map<string, ZEntry>();
  for (const c of csvs) { const key = noExt(c.norm).replace(/_all$/, ""); const cur = csvKeys.get(key); if (!cur || /_all\.csv$/i.test(c.norm)) csvKeys.set(key, c); }
  // shallow files first so parents exist before children
  md.sort((a, b) => a.norm.split("/").length - b.norm.split("/").length || a.norm.localeCompare(b.norm));
  for (const m of meta) ignored.push(m.norm);
  return { notion, obsidian, ownExport: meta.some((m) => m.norm === "workspace.json"), strip, md, csvKeys, bibs, others, ignored, files: facts.files, totalUncompressed: facts.totalUncompressed };
}
/**
 * Reads every CSV of the plan once. A CSV without a header line is empty: it is taken out of the plan (the Markdown files of its folder
 * then are ordinary pages) and its name is returned, so the preview and the import skip it the same way instead of failing the archive.
 */
export async function readCsvs(plan: ZipPlan): Promise<{ texts: Map<string, string>; empty: string[] }> {
  const texts = new Map<string, string>(); const empty: string[] = [];
  for (const [key, csv] of [...plan.csvKeys]) { const t = await readText(csv); if (parseCsv(t).header.length) texts.set(key, t); else { plan.csvKeys.delete(key); empty.push(csv.norm); } }
  return { texts, empty };
}
/** Files of one database folder in the order the export numbered them: `row.md`, `row-2.md`, `row-3.md`… `row-10.md`. */
export const rowFileOrder = (a: ZEntry, b: ZEntry) => { const x = noExt(a.norm), y = noExt(b.norm); return x.length - y.length || (x < y ? -1 : x > y ? 1 : 0); };
const dateOf = (v: unknown): Date | undefined => { if (v === null || v === undefined || v === "") return undefined; const d = new Date(String(v)); return isNaN(d.getTime()) ? undefined : d; };
/** Markdown files that become ordinary pages (the files directly inside a database folder are row bodies). */
export const pageEntries = (plan: ZipPlan) => plan.md.filter((e) => !plan.csvKeys.has(dirOf(noExt(e.norm))));
/** The non-Markdown member a relative reference points to (relative to the referencing file, raw or normalised names). */
export function findOther(plan: ZipPlan, fromKey: string, ref: string): ZEntry | null {
  const base = dirOf(fromKey);
  const candidates = [path.posix.normalize(path.posix.join(base, ref)), path.posix.normalize(ref)].map((c) => c.replace(/^(\.\/)+/, ""));
  for (const c of candidates) {
    if (c.startsWith("../") || c === "..") continue; // outside the archive
    const nc = normPath(c);
    const hit = plan.others.find((o) => o.norm === nc || o.norm === c || o.raw.slice(plan.strip.length) === c || normPath(o.raw.slice(plan.strip.length)) === nc);
    if (hit) return hit;
  }
  return null;
}

export async function importZip(ctx: ImportCtx, buf: Buffer, opts: { parentId?: string | null; filename?: string }) {
  const plan = await openZip(buf);
  const { md, csvKeys, bibs, others } = plan;
  // texts that are needed twice (count, then import) are read once; an empty CSV leaves the plan here, before the pages are listed
  const { texts: csvText, empty: emptyCsv } = await readCsvs(plan); const bibText = new Map<string, string>();
  for (const name of emptyCsv) ctx.stats.skipped.push(`“${name}” is empty — skipped`);
  const pages = pageEntries(plan);
  let total = pages.length * 2;
  for (const t of csvText.values()) total += 1 + parseCsv(t).rows.length;
  for (const b of bibs) { const t = await readText(b); bibText.set(b.norm, t); try { total += parseBibtexSafe(t).length; } catch { /* reported when imported */ } }
  ctx.total += total;
  await ctx.progress?.({ done: ctx.done, total: ctx.total, message: `Reading ${plan.files} files` });

  // ---- pass 1: create every page (title only) so that links can resolve in pass 2
  const pageByKey = new Map<string, Page>(); // key = normalised path without extension
  const reused = new Map<string, string>(); // key → id of the identical page that already existed
  const dbByKey = new Map<string, { page: Page; csv: ZEntry }>();
  const mine = (key: string) => Boolean(ctx.ledger?.has(`page:${key}`));
  const folderPage = async (dirKey: string): Promise<string | null> => {
    if (!dirKey) return opts.parentId ?? null;
    const hit = pageByKey.get(dirKey); if (hit) return hit.id;
    const again = reused.get(dirKey); if (again) return again;
    const title = path.posix.basename(dirKey);
    if (!mine(`zip-folder:${dirKey}`)) { const dup = findDuplicatePage(ctx, title, ""); if (dup) { reused.set(dirKey, dup.id); ctx.paths.set(dirKey, dup.id); ctx.stats.duplicates++; return dup.id; } }
    const parent = await folderPage(dirOf(dirKey));
    const p = await createPage(ctx, { key: `zip-folder:${dirKey}`, title, parentId: parent, section: "notes", icon: "📁" });
    pageByKey.set(dirKey, p); ctx.paths.set(dirKey, p.id); return p.id;
  };
  const titleOf = async (e: ZEntry) => { const text = await readText(e); const r = readMarkdown(text, path.posix.basename(e.norm)); return { text, title: r.title, data: r.data, body: r.body }; };
  const mdText = new Map<string, { text: string; data: Record<string, unknown> }>();
  for (const e of pages) {
    const key = noExt(e.norm);
    const { text, title, data, body } = await titleOf(e);
    if (!mine(`zip:${key}`)) {
      const dup = findDuplicatePage(ctx, title, previewText(body));
      if (dup) { reused.set(key, dup.id); ctx.paths.set(key, dup.id); ctx.stats.duplicates++; await tick(ctx, `Already exists: ${title}`, 2); continue; }
    }
    mdText.set(key, { text, data });
    const parent = await folderPage(dirOf(key));
    const p = await createPage(ctx, { key: `zip:${key}`, title, parentId: parent, section: typeof data.section === "string" ? data.section : "notes", icon: typeof data.icon === "string" ? data.icon.slice(0, 16) : null, createdAt: dateOf(data.created) }); // pass 2 only updates: the creation date of the front-matter is set here
    pageByKey.set(key, p); ctx.paths.set(key, p.id);
    await tick(ctx, `Page ${title}`);
  }
  // ---- attachments on demand
  const attCache = new Map<string, { id: string; filename: string; mime: string; size: number } | null>();
  const resolverFor = (fromKey: string, pageId: string | null) => async (ref: string) => {
    const hit = findOther(plan, fromKey, ref); if (!hit) return null;
    if (!attCache.has(hit.norm)) { const b = await readEntry(hit); const a = await createAttachment(ctx, b, path.posix.basename(hit.norm), mimeOf(hit.norm), pageId, `zip:${hit.norm}`); attCache.set(hit.norm, { id: a.id, filename: a.filename, mime: a.mime, size: a.size }); }
    return attCache.get(hit.norm)!;
  };
  const resolvePath = (fromKey: string) => (ref: string) => { const base = dirOf(fromKey); for (const c of [path.posix.join(base, ref), ref]) { const k = noExt(normPath(path.posix.normalize(c).replace(/^(\.\/)+/, ""))); const id = ctx.paths.get(k); if (id) return id; } return null; };

  // ---- databases (CSV + row bodies from `<Name>/<Row title>.md`)
  for (const [key, csv] of csvKeys) {
    const parent = await folderPage(dirOf(key));
    const rowFiles = md.filter((e) => dirOf(noExt(e.norm)) === key);
    // several rows may share a title: each title keeps a queue of files, taken in the order the export wrote them (`row.md`, `row-2.md`…)
    const bodies = new Map<string, ZEntry[]>(); for (const rf of [...rowFiles].sort(rowFileOrder)) { const { title } = await titleOf(rf); const k = title.toLowerCase(); const q = bodies.get(k); if (q) q.push(rf); else bodies.set(k, [rf]); }
    const name = path.posix.basename(key);
    const existing = pageByKey.get(key); // `Name.md` next to `Name.csv` (Notion inline db page) → use its text as description
    const res = await importCsv(ctx, csvText.get(key)!, { key: `zip:${key}`, name, parentId: parent, rowContent: async (title) => { const q = bodies.get(title.toLowerCase()); const rf = q?.shift(); if (!rf) return undefined; if (!q!.length) bodies.delete(title.toLowerCase()); const t = await readText(rf); const { data, body } = parseFrontMatter(t); const nh = parseNotionHeader(body); return { content: await mdToDoc(ctx, nh.body, { resolveFile: resolverFor(noExt(rf.norm), null), resolvePath: resolvePath(noExt(rf.norm)) }), createdAt: dateOf(data.created), updatedAt: dateOf(data.updated) }; } });
    dbByKey.set(key, { page: res.page, csv }); ctx.paths.set(key, res.page.id);
    if (res.duplicate) continue; // the database already exists: its row files belong to it, nothing to add
    if (existing) { // merge: the standalone page becomes redundant → keep as child "(notes)" page only if it has a body
      const t = mdText.get(key)!; const { body } = parseFrontMatter(t.text); const nh = parseNotionHeader(body);
      if (nh.body.trim()) await updatePage(ctx, existing.id, { parentId: res.page.id, title: `${name} (notes)`, content: await mdToDoc(ctx, nh.body, { resolveFile: resolverFor(key, existing.id), resolvePath: resolvePath(key) }) });
      else { const { db, schema } = await import("@/db"); const { eq } = await import("drizzle-orm"); await db.delete(schema.pages).where(eq(schema.pages.id, existing.id)); ctx.stats.pages--; }
      // handled here: pass 2 must not rewrite (or look for) this page
      pageByKey.delete(key); mdText.delete(key); await tick(ctx);
    }
    // row subpages that did not match a CSV row → ordinary children of the database page
    for (const rf of [...bodies.values()].flat()) { const { text: t, title, data } = await titleOf(rf); const k = noExt(rf.norm); mdText.set(k, { text: t, data }); const p = await createPage(ctx, { key: `zip:${k}`, title, parentId: res.page.id, createdAt: dateOf(data.created) }); pageByKey.set(k, p); ctx.paths.set(k, p.id); }
  }
  // ---- pass 2: bodies with resolved links/attachments (a body already written by an earlier attempt is not redone)
  for (const [key, p] of pageByKey) {
    const src = mdText.get(key); if (!src) continue; // folder pages
    if (!ctx.ledger?.has(`body:${key}`)) {
      await importMarkdown(ctx, src.text, { existingId: p.id, filename: path.posix.basename(key), resolveFile: resolverFor(key, p.id), resolvePath: resolvePath(key) });
      await ctx.ledger?.claim(`body:${key}`);
    }
    await tick(ctx, `Page ${p.title}`);
  }
  for (const b of bibs) { const r = await importBibtexRefs(ctx, bibText.get(b.norm)!, null, `zip:${b.norm}`); if (r.skipped.length) ctx.stats.skipped.push(`${b.norm}: ${r.skipped.length} reference(s) already stored — ${r.skipped.slice(0, 5).map((s) => s.citeKey).join(", ")}${r.skipped.length > 5 ? "…" : ""}`); }
  const unreferenced = others.filter((o) => !attCache.has(o.norm) && !ctx.ledger?.has(`att:zip:${o.norm}`));
  if (unreferenced.length) ctx.stats.skipped.push(`${unreferenced.length} file(s) not referenced by any page were not imported: ${unreferenced.slice(0, 5).map((o) => o.norm).join(", ")}${unreferenced.length > 5 ? "…" : ""}`);
  if (plan.ignored.length) ctx.stats.skipped.push(`${plan.ignored.length} settings/metadata file(s) ignored`);
  const roots = [...pageByKey.values()].filter((p) => p.parentId === (opts.parentId ?? null));
  const firstRoot = roots[0] ?? [...dbByKey.values()][0]?.page ?? null;
  return { notion: plan.notion, pageId: firstRoot?.id ?? [...reused.values()][0] ?? null, pages: pageByKey.size, databases: dbByKey.size };
}
