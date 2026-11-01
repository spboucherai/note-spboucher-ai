/**
 * ZIP of Markdown (plain, Obsidian, our own export) or a Notion "Markdown & CSV" export → page tree.
 * Rules: folders mirror parents (`Foo.md` + `Foo/` → children of Foo); Notion `Name <32hex>` suffixes stripped; `Name.csv` → database
 * (`Name_all.csv` preferred, the filtered copy skipped) with `Name/<row title>.md` as row bodies; other files become attachments
 * when referenced; `references.bib` → references; `workspace.json` is ignored (metadata only).
 */
import path from "node:path";
import JSZip from "jszip";
import { createAttachment, createPage, mimeOf, updatePage, type ImportCtx, type Page } from "./pages";
import { importMarkdown, mdToDoc, parseFrontMatter, parseNotionHeader } from "./markdown";
import { importCsv } from "./csv";
import { importBibtexRefs } from "./bibtex";

const NOTION_ID = /\s+[0-9a-f]{32}(?=(\.[a-z0-9]+)?$)/i;
const stripId = (seg: string) => seg.replace(NOTION_ID, "");
const normSeg = (s: string) => stripId(s).normalize("NFC").trim();
const normPath = (p: string) => p.split("/").filter(Boolean).map(normSeg).join("/");
const noExt = (p: string) => p.replace(/\.[^./]+$/, "");
const isNotionExport = (names: string[]) => names.some((n) => NOTION_ID.test(path.posix.basename(n)));

interface Entry { raw: string; norm: string; file: JSZip.JSZipObject }
export async function importZip(ctx: ImportCtx, buf: Buffer, opts: { parentId?: string | null; filename?: string }) {
  const zip = await JSZip.loadAsync(buf);
  const entries: Entry[] = [];
  zip.forEach((rel, f) => { if (f.dir) return; const parts = rel.split("/"); if (parts.some((p) => p === "__MACOSX" || p === ".DS_Store" || p.startsWith("._"))) return; entries.push({ raw: rel, norm: normPath(rel), file: f }); });
  entries.sort((a, b) => a.norm.localeCompare(b.norm));
  const notion = isNotionExport(entries.map((e) => e.raw));
  // Strip a single common top-level folder (Notion exports and `zip -r folder` both produce one)
  const tops = new Set(entries.map((e) => e.norm.split("/")[0]));
  const strip = tops.size === 1 && entries.every((e) => e.norm.includes("/")) ? `${[...tops][0]}/` : "";
  for (const e of entries) e.norm = e.norm.slice(strip.length);
  const md = entries.filter((e) => /\.(md|markdown)$/i.test(e.norm) && !/\/?workspace\.json$/.test(e.norm));
  const csvs = entries.filter((e) => /\.csv$/i.test(e.norm));
  const bibs = entries.filter((e) => /\.bib$/i.test(e.norm));
  const others = entries.filter((e) => !md.includes(e) && !csvs.includes(e) && !bibs.includes(e) && !/\/?workspace\.json$/.test(e.norm));
  // Notion: prefer `_all.csv`, skip the filtered twin
  const csvKeys = new Map<string, Entry>();
  for (const c of csvs) { const key = noExt(c.norm).replace(/_all$/, ""); const cur = csvKeys.get(key); if (!cur || /_all\.csv$/i.test(c.norm)) csvKeys.set(key, c); }
  const total = md.length + csvKeys.size; let done = 0;
  const tick = async (msg: string) => { done++; if (done % 5 === 0 || done === total) await ctx.progress?.({ progress: Math.min(0.95, 0.05 + (0.9 * done) / Math.max(1, total)), message: msg }); };

  // ---- pass 1: create every page (title only) so that links can resolve in pass 2
  const pageByKey = new Map<string, Page>(); // key = normalised path without extension
  const dbByKey = new Map<string, { page: Page; csv: Entry }>();
  const folderPage = async (dirKey: string): Promise<string | null> => {
    if (!dirKey) return opts.parentId ?? null;
    const hit = pageByKey.get(dirKey); if (hit) return hit.id;
    const parent = await folderPage(path.posix.dirname(dirKey) === "." ? "" : path.posix.dirname(dirKey));
    const p = await createPage(ctx, { title: path.posix.basename(dirKey), parentId: parent, section: "notes", icon: "📁" });
    pageByKey.set(dirKey, p); ctx.paths.set(dirKey, p.id); return p.id;
  };
  const titleOf = async (e: Entry) => { const text = await e.file.async("string"); const { data, body } = parseFrontMatter(text); const nh = parseNotionHeader(body); return { text, title: String(data.title ?? nh.title ?? path.posix.basename(noExt(e.norm))).trim() || "Untitled", data }; };
  const mdText = new Map<string, { text: string; data: Record<string, unknown> }>();
  // shallow files first so parents exist before children
  md.sort((a, b) => a.norm.split("/").length - b.norm.split("/").length || a.norm.localeCompare(b.norm));
  for (const e of md) {
    const key = noExt(e.norm); const dirKey = path.posix.dirname(key) === "." ? "" : path.posix.dirname(key);
    // row pages of a database folder are created by the CSV import (matched by title) — defer them
    if (csvKeys.has(dirKey)) continue;
    const { text, title, data } = await titleOf(e); mdText.set(key, { text, data });
    const parent = await folderPage(dirKey);
    const p = await createPage(ctx, { title, parentId: parent, section: typeof data.section === "string" ? data.section : "notes", icon: typeof data.icon === "string" ? data.icon.slice(0, 16) : null });
    pageByKey.set(key, p); ctx.paths.set(key, p.id);
  }
  // ---- attachments on demand (relative to the referencing file, raw or normalised names)
  const attCache = new Map<string, { id: string; filename: string; mime: string; size: number } | null>();
  const resolverFor = (fromKey: string, pageId: string | null) => async (ref: string) => {
    const base = path.posix.dirname(fromKey) === "." ? "" : path.posix.dirname(fromKey);
    const candidates = [path.posix.normalize(path.posix.join(base, ref)), path.posix.normalize(ref)].map((c) => c.replace(/^(\.\/)+/, ""));
    for (const c of candidates) {
      const nc = normPath(c);
      const hit = others.find((o) => o.norm === nc || o.norm === c || o.raw.slice(strip.length) === c || normPath(o.raw.slice(strip.length)) === nc);
      if (!hit) continue;
      if (!attCache.has(hit.norm)) { const b = await hit.file.async("nodebuffer"); const a = await createAttachment(ctx, b, path.posix.basename(hit.norm), mimeOf(hit.norm), pageId); attCache.set(hit.norm, { id: a.id, filename: a.filename, mime: a.mime, size: a.size }); }
      return attCache.get(hit.norm)!;
    }
    return null;
  };
  const resolvePath = (fromKey: string) => (ref: string) => { const base = path.posix.dirname(fromKey) === "." ? "" : path.posix.dirname(fromKey); for (const c of [path.posix.join(base, ref), ref]) { const k = noExt(normPath(path.posix.normalize(c).replace(/^(\.\/)+/, ""))); const id = ctx.paths.get(k); if (id) return id; } return null; };

  // ---- databases (CSV + row bodies from `<Name>/<Row title>.md`)
  for (const [key, csv] of csvKeys) {
    const dirKey = path.posix.dirname(key) === "." ? "" : path.posix.dirname(key);
    const parent = await folderPage(dirKey);
    const rowFiles = md.filter((e) => path.posix.dirname(noExt(e.norm)) === key);
    const bodies = new Map<string, Entry>(); for (const rf of rowFiles) { const { title } = await titleOf(rf); bodies.set(title.toLowerCase(), rf); }
    const text = await csv.file.async("string");
    const name = path.posix.basename(key);
    const existing = pageByKey.get(key); // `Name.md` next to `Name.csv` (Notion inline db page) → use its text as description
    const res = await importCsv(ctx, text, { name, parentId: parent, rowContent: async (title) => { const rf = bodies.get(title.toLowerCase()); if (!rf) return undefined; bodies.delete(title.toLowerCase()); const t = await rf.file.async("string"); const { body } = parseFrontMatter(t); const nh = parseNotionHeader(body); return mdToDoc(ctx, nh.body, { resolveFile: resolverFor(noExt(rf.norm), null), resolvePath: resolvePath(noExt(rf.norm)) }); } });
    dbByKey.set(key, { page: res.page, csv }); ctx.paths.set(key, res.page.id);
    if (existing) { // merge: the standalone page becomes redundant → keep as child "About" page only if it has a body
      const t = mdText.get(key)!; const { body } = parseFrontMatter(t.text); const nh = parseNotionHeader(body);
      if (nh.body.trim()) await updatePage(ctx, existing.id, { parentId: res.page.id, title: `${name} (notes)`, content: await mdToDoc(ctx, nh.body, { resolveFile: resolverFor(key, existing.id), resolvePath: resolvePath(key) }) }); else { const { db, schema } = await import("@/db"); const { eq } = await import("drizzle-orm"); await db.delete(schema.pages).where(eq(schema.pages.id, existing.id)); ctx.stats.pages--; }
    }
    // row subpages that did not match a CSV row → ordinary children of the database page
    for (const rf of bodies.values()) { const { text: t, title, data } = await titleOf(rf); const k = noExt(rf.norm); mdText.set(k, { text: t, data }); const p = await createPage(ctx, { title, parentId: res.page.id }); pageByKey.set(k, p); ctx.paths.set(k, p.id); }
    await tick(`Database ${name}: ${res.rows} rows`);
  }
  // ---- pass 2: bodies with resolved links/attachments
  for (const [key, p] of pageByKey) {
    const src = mdText.get(key); if (!src) continue; // folder pages
    await importMarkdown(ctx, src.text, { existingId: p.id, filename: path.posix.basename(key), resolveFile: resolverFor(key, p.id), resolvePath: resolvePath(key) });
    await tick(`Page ${p.title}`);
  }
  for (const b of bibs) { const text = await b.file.async("string"); const r = await importBibtexRefs(ctx, text, null); if (r.skipped.length) ctx.stats.skipped.push(...r.skipped.map((s) => `${b.norm}: ${s.citeKey} ${s.reason}`)); }
  const unreferenced = others.filter((o) => !attCache.has(o.norm));
  if (unreferenced.length) ctx.stats.skipped.push(`${unreferenced.length} unreferenced file(s) ignored: ${unreferenced.slice(0, 5).map((o) => o.norm).join(", ")}${unreferenced.length > 5 ? "…" : ""}`);
  const roots = [...pageByKey.values()].filter((p) => p.parentId === (opts.parentId ?? null));
  const firstRoot = roots[0] ?? [...dbByKey.values()][0]?.page ?? null;
  return { notion, pageId: firstRoot?.id ?? null, pages: pageByKey.size, databases: dbByKey.size };
}
