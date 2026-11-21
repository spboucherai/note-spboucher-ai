/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/import/preview.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
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
 * Import preview: analyses an uploaded file and reports what WOULD be created — nothing is written (no page, no attachment, no file in
 * data/uploads). Used by POST /api/import?preview=1; the user then confirms with "skip duplicates" (default) or "import anyway".
 *
 * Duplicates: pages by title + content hash (normalised text, see validate.ts contentKey), databases by name + row count, DOCX/PDF by the
 * sha256 of the file, references by DOI then cite key, JSON backup rows by id.
 */
import path from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { loadExisting, dbKey, type ExistingIndex } from "./pages";
import { contentKey, fmtSize, sha256Hex, validateUpload, ImportError, type ImportKind } from "./validate";
import { previewText, readMarkdown, relativeRefs } from "./markdown";
import { csvPlan } from "./csv";
import { bibDuplicates, parseBibtexSafe } from "./bibtex";
import { checkBackupFormat, RESTORE_TABLES } from "./restore";
import { openZip, pageEntries, readText, readCsvs, findOther, noExt, dirOf } from "./zip";
import { JSON_FORMAT } from "@/lib/export/json";

export interface PreviewCounts { pages: number; databases: number; rows: number; references: number; attachments: number }
export interface PreviewNode { title: string; depth: number; kind: "page" | "folder" | "database" | "file"; duplicate?: boolean; note?: string }
export interface ImportPreview {
  kind: ImportKind; detected: string; filename: string; size: number;
  /** what is created with "skip duplicates" */ counts: PreviewCounts; /** what is created with "import anyway" */ countsAll: PreviewCounts;
  tree: PreviewNode[]; treeTruncated: number;
  duplicates: { total: number; pages: { title: string; existingId: string }[]; databases: { title: string; existingId: string }[]; references: { citeKey: string; reason: string }[]; note?: string };
  warnings: string[];
  /** wording of the two choices for this kind of file */ modes: { skip: string; import: string };
}
const TREE_MAX = 400; const LIST_MAX = 100;
const zero = (): PreviewCounts => ({ pages: 0, databases: 0, rows: 0, references: 0, attachments: 0 });
const MODES = { skip: "Skip what already exists", import: "Import everything again (creates copies)" };
const liveRefs = (wsId: string) => db.select({ citeKey: schema.researchReferences.citeKey, doi: schema.researchReferences.doi }).from(schema.researchReferences).where(and(eq(schema.researchReferences.workspaceId, wsId), isNull(schema.researchReferences.deletedAt)));

export async function previewImport(input: { workspaceId: string; kind: ImportKind; buffer: Buffer; filename: string }): Promise<ImportPreview> {
  const { kind, buffer } = input; const filename = input.filename.replace(/^.*[\\/]/, ""); const base = filename.replace(/\.[^.]+$/, "");
  const facts = validateUpload({ kind, buffer, filename });
  const existing = await loadExisting(input.workspaceId);
  const out: ImportPreview = { kind, detected: kind, filename, size: buffer.length, counts: zero(), countsAll: zero(), tree: [], treeTruncated: 0, duplicates: { total: 0, pages: [], databases: [], references: [] }, warnings: [], modes: MODES };
  const text = () => buffer.toString("utf8");
  const nodes: PreviewNode[] = [];
  const page = (title: string, body: string, depth: number, kind: PreviewNode["kind"] = "page") => {
    const dup = existing.pages.get(contentKey(title.trim().slice(0, 500) || "Untitled", body));
    out.countsAll.pages++; if (dup) { out.duplicates.total++; if (out.duplicates.pages.length < LIST_MAX) out.duplicates.pages.push({ title, existingId: dup.id }); } else out.counts.pages++;
    nodes.push({ title, depth, kind, ...(dup ? { duplicate: true } : {}) }); return Boolean(dup);
  };
  const refs = async (t: string, label = "") => {
    const parsed = parseBibtexSafe(t); const { fresh, duplicates } = bibDuplicates(parsed, await liveRefs(input.workspaceId));
    const stored = duplicates.filter((d) => !d.inFile);
    out.counts.references += fresh.length; out.countsAll.references += fresh.length + stored.length; out.duplicates.total += duplicates.length;
    for (const d of duplicates) if (out.duplicates.references.length < LIST_MAX) out.duplicates.references.push({ citeKey: d.citeKey, reason: d.reason });
    if (!parsed.length) out.warnings.push(`${label || "The file"} contains no BibTeX entry.`);
    return parsed.length;
  };
  const database = (name: string, csv: string, depth: number) => {
    const plan = csvPlan(csv); if (!plan.header.length) { out.warnings.push(`“${name}.csv” is empty: nothing would be imported from it.`); return; }
    for (const w of plan.warnings) out.warnings.push(`${name}.csv: ${w}`);
    const dup = existing.databases.get(dbKey(name, plan.rows.length));
    out.countsAll.databases++; out.countsAll.rows += plan.rows.length;
    if (dup) { out.duplicates.total++; if (out.duplicates.databases.length < LIST_MAX) out.duplicates.databases.push({ title: name, existingId: dup.pageId }); } else { out.counts.databases++; out.counts.rows += plan.rows.length; }
    nodes.push({ title: name, depth, kind: "database", note: `${plan.rows.length} rows · ${plan.columns.length + 1} columns (${plan.columns.slice(0, 6).map((c) => `${c.name}: ${c.type}`).join(", ")}${plan.columns.length > 6 ? "…" : ""})`, ...(dup ? { duplicate: true } : {}) });
  };
  const fileDup = (title: string, what: string) => {
    const hit = existing.files.get(sha256Hex(buffer));
    out.countsAll.pages++; out.countsAll.attachments++;
    if (hit) { out.duplicates.total++; out.duplicates.pages.push({ title: hit.title, existingId: hit.pageId }); out.duplicates.note = `This exact ${what} is already stored on the page “${hit.title}”.`; } else { out.counts.pages++; out.counts.attachments++; }
    nodes.push({ title, depth: 0, kind: "page", ...(hit ? { duplicate: true } : {}) });
  };

  switch (kind) {
    case "markdown": {
      out.detected = "Markdown / text file";
      const r = readMarkdown(text(), filename); page(r.title, previewText(r.body), 0);
      const rel = relativeRefs(r.body); if (rel.images.length) out.warnings.push(`${rel.images.length} local image(s) cannot be imported from a single file (they will appear as “[image: …]”). Import a ZIP that contains them to keep the images.`);
      break;
    }
    case "csv": { out.detected = "CSV → database"; database(base, text(), 0); break; }
    case "bibtex": { out.detected = "BibTeX → references"; await refs(text()); break; }
    case "pdf": {
      out.detected = "PDF → page with the file and its text"; fileDup(base, "PDF");
      out.warnings.push("Only the text layer is extracted; layout and images stay in the attached PDF. A scanned PDF yields no text.");
      break;
    }
    case "docx": {
      out.detected = "Word document → page"; fileDup(base, "document");
      const images = facts.zip?.entries.filter((e) => /^word\/media\/.+/.test(e.name)).length ?? 0;
      out.countsAll.attachments += images; if (!out.duplicates.pages.length) out.counts.attachments += images;
      if (images) nodes.push({ title: `${images} embedded image(s)`, depth: 1, kind: "file" });
      out.warnings.push("Fonts, colours, footnotes, comments, tracked changes and text boxes are not imported; the original .docx is attached to the page.");
      break;
    }
    case "json": {
      let data: any; try { data = JSON.parse(text()); } catch { throw new ImportError("The file is not valid JSON.", 400, "bad_json"); }
      checkBackupFormat(data);
      out.detected = `Note SPBoucher AI JSON backup${typeof data.exportedAt === "string" ? ` of ${data.exportedAt.slice(0, 10)}` : ""}`;
      if (data.format !== JSON_FORMAT) out.warnings.push(`Backup format ${String(data.format)} differs from ${JSON_FORMAT}: restored on a best-effort basis.`);
      const arr = (k: string): any[] => (Array.isArray(data[k]) ? data[k] : []);
      const pages = arr("pages"); const ids = pages.map((p) => String(p.id)).filter((s) => /^[0-9a-f-]{36}$/.test(s));
      const have = new Set<string>(); for (let i = 0; i < ids.length; i += 1000) for (const r of await db.select({ id: schema.pages.id }).from(schema.pages).where(inArray(schema.pages.id, ids.slice(i, i + 1000)))) have.add(r.id);
      const rowPages = pages.filter((p) => p.databaseId).length;
      out.countsAll = { pages: pages.length - rowPages, databases: arr("databases").length, rows: arr("databaseRows").length, references: arr("references").length, attachments: arr("attachments").length };
      const share = pages.length ? (pages.length - have.size) / pages.length : 1;
      out.counts = { pages: pages.filter((p) => !p.databaseId && !have.has(String(p.id))).length, databases: Math.round(out.countsAll.databases * share), rows: Math.round(out.countsAll.rows * share), references: Math.round(out.countsAll.references * share), attachments: Math.round(out.countsAll.attachments * share) };
      out.duplicates.total = have.size;
      if (have.size) out.duplicates.note = `${have.size} of ${pages.length} pages in the backup already exist here (same id). “${MODES_JSON.skip}” leaves them exactly as they are now; “${MODES_JSON.import}” replaces them with the backup's version: the current text of those pages is overwritten and cannot be brought back from here (export a JSON backup of the current state first if unsure). It asks for your passkey.`;
      out.modes = MODES_JSON;
      for (const p of pages.filter((p) => !p.parentId && !p.databaseId).slice(0, TREE_MAX)) nodes.push({ title: String(p.title ?? "Untitled"), depth: 0, kind: p.type === "database" ? "database" : "page", ...(have.has(String(p.id)) ? { duplicate: true } : {}) });
      const other = RESTORE_TABLES.filter((t) => !["pages", "databases", "databaseRows", "references", "attachments"].includes(t)).map((t) => `${t}: ${arr(t).length}`).join(", ");
      out.warnings.push(`Also restored: ${other}.`);
      out.warnings.push("Attachment files are not inside a JSON backup: their rows are restored, the files must already be in data/uploads (or come from the encrypted backup).");
      if (data.workspace?.id && data.workspace.id !== input.workspaceId) out.warnings.push(`This backup comes from another workspace (“${String(data.workspace.name ?? "?").slice(0, 80)}”); its rows are merged into the current one.`);
      break;
    }
    case "zip": {
      const plan = await openZip(buffer);
      // same rule as the import: an empty CSV is skipped, and the Markdown files of its folder are ordinary pages
      const { texts: csvTexts, empty: emptyCsv } = await readCsvs(plan); for (const name of emptyCsv) out.warnings.push(`“${name}” is empty and will be skipped.`);
      out.detected = plan.notion ? "Notion export (Markdown & CSV)" : plan.ownExport ? "Note SPBoucher AI export (ZIP)" : plan.obsidian ? "Obsidian vault (ZIP)" : "Markdown archive (ZIP)";
      const pages = pageEntries(plan); const keys = new Set(pages.map((e) => noExt(e.norm)));
      type Item = { key: string; title: string; kind: PreviewNode["kind"]; body?: string; csv?: string };
      const items: Item[] = []; const folders = new Set<string>();
      const needFolder = (dirKey: string) => { for (let d = dirKey; d; d = dirOf(d)) { if (keys.has(d) || folders.has(d)) break; folders.add(d); } };
      const used = new Set<string>(); let missingImages = 0; const bodies = new Map<string, string>();
      for (const e of pages) { const key = noExt(e.norm); const r = readMarkdown(await readText(e), path.posix.basename(e.norm)); items.push({ key, title: r.title, kind: "page", body: r.body }); bodies.set(key, r.body); needFolder(dirOf(key)); }
      for (const key of plan.csvKeys.keys()) { items.push({ key, title: path.posix.basename(key), kind: "database", csv: csvTexts.get(key) ?? "" }); needFolder(dirOf(key)); }
      for (const f of folders) items.push({ key: f, title: path.posix.basename(f), kind: "folder", body: "" });
      const seg = (k: string) => k.split("/");
      items.sort((a, b) => { const x = seg(a.key), y = seg(b.key); for (let i = 0; i < Math.min(x.length, y.length); i++) { const c = x[i].localeCompare(y[i]); if (c) return c; } return x.length - y.length || (a.kind === "database" ? 1 : -1); });
      for (const it of items) {
        const depth = seg(it.key).length - 1;
        if (it.kind === "database") { database(it.title, it.csv ?? "", depth); continue; }
        const dup = page(it.title, it.kind === "folder" ? "" : previewText(it.body ?? ""), depth, it.kind);
        if (it.kind === "page" && !dup) { const rel = relativeRefs(it.body ?? ""); for (const ref of [...rel.images, ...rel.links.filter((l) => !/\.(md|markdown)$/i.test(l))]) { const hit = findOther(plan, it.key, ref); if (hit) used.add(hit.norm); else if (rel.images.includes(ref)) missingImages++; } }
      }
      // rows of a database may carry a body with images too
      for (const e of plan.md) { const key = noExt(e.norm); if (keys.has(key)) continue; const r = readMarkdown(await readText(e), path.posix.basename(e.norm)); const rel = relativeRefs(r.body); for (const ref of [...rel.images, ...rel.links.filter((l) => !/\.(md|markdown)$/i.test(l))]) { const hit = findOther(plan, key, ref); if (hit) used.add(hit.norm); else if (rel.images.includes(ref)) missingImages++; } }
      out.counts.attachments = out.countsAll.attachments = used.size;
      for (const b of plan.bibs) await refs(await readText(b), b.norm);
      if (missingImages) out.warnings.push(`${missingImages} image link(s) point to files that are not in the archive; they will appear as “[image: …]”.`);
      const unreferenced = plan.others.filter((o) => !used.has(o.norm));
      if (unreferenced.length) out.warnings.push(`${unreferenced.length} file(s) are not referenced by any page and will not be imported (${unreferenced.slice(0, 4).map((o) => path.posix.basename(o.norm)).join(", ")}${unreferenced.length > 4 ? "…" : ""}).`);
      if (plan.ignored.length) out.warnings.push(`${plan.ignored.length} settings/metadata file(s) are ignored (${plan.ownExport ? "workspace.json is not used: ids are not reused — use the JSON backup for an identical restore" : "application folders such as .obsidian"}).`);
      if (plan.notion) out.warnings.push("Notion relations, rollups and formulas become plain text; comments, icons and covers are not part of Notion's export.");
      if (folders.size) out.warnings.push(`${folders.size} folder(s) without a page of their own become 📁 pages.`);
      if (!items.length && !plan.bibs.length) out.warnings.push("No Markdown, CSV or BibTeX file was found in this archive: nothing would be imported.");
      out.warnings.push(`Archive: ${plan.files} files, ${fmtSize(plan.totalUncompressed)} uncompressed.`);
      if (out.duplicates.pages.length) out.duplicates.note = "With “skip”, pages below an existing identical page are attached to that existing page.";
      break;
    }
  }
  out.tree = nodes.slice(0, TREE_MAX); out.treeTruncated = Math.max(0, nodes.length - TREE_MAX);
  return out;
}
const MODES_JSON = { skip: "Keep what exists, add only what is missing", import: "Overwrite existing pages with the backup" };
export type { ExistingIndex };
