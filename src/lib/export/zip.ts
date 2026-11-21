/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/export/zip.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-17
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
 * Workspace / subtree → ZIP (streamed with jszip generateNodeStream; attachments are streamed from disk, never buffered).
 * Layout: <parents…>/<slug>.md, children under <slug>/, databases as <slug>.csv + <slug>/<row>.md, attachments/, references.bib, workspace.json,
 * export-report.json (counts + everything that could NOT be included, so a loss is never silent).
 */
import fs from "node:fs";
import { PassThrough, Readable } from "node:stream";
import JSZip from "jszip";
import { absPath } from "@/lib/files/storage";
import { bibFile } from "@/lib/research/bibtex";
import { slugify } from "@/lib/utils";
import { assignPaths, attachmentFile, loadExportSet, tagsOf, type ExportSet } from "./data";
import { pageMarkdown, zipResolvers, attachmentIdOf } from "./markdown";
import { databaseCsv } from "./csv";
import { JSON_FORMAT } from "./json";

/** jszip has no zip64 support → hard cap; the JSON export + per-subtree ZIPs are the escape hatch. */
export const ZIP_MAX_BYTES = Number(process.env.EXPORT_MAX_BYTES ?? 500 * 1024 * 1024);
export class ExportTooLarge extends Error { constructor(public bytes: number) { super(`Export too large (${(bytes / 1048576).toFixed(0)} MB > ${(ZIP_MAX_BYTES / 1048576).toFixed(0)} MB). Export subtrees separately or use the JSON backup.`); } }

export interface ExportReport {
  format: "note-spboucher-ai/export-report/1"; kind: "workspace" | "subtree"; exportedAt: string; rootId: string | null;
  counts: { pages: number; databases: number; rows: number; attachments: number; attachmentBytes: number; references: number; experiments: number; tasks: number; tags: number };
  /** true when nothing that belongs to the export is missing from it */
  complete: boolean;
  /** things that should be in the archive and are not */
  notIncluded: { type: "attachment" | "file-link" | "database-row"; id: string; filename?: string; pageId?: string | null; reason: string }[];
  /** links that leave the exported set (kept as text / app links) */
  unresolved: { mentionsOutsideExport: number; pagesOutsideExport: string[] };
  /** what the Markdown layout never carries */
  byDesign: string[];
}
const BY_DESIGN = [
  "Editor-only blocks are flattened to Markdown (callouts → > [!NOTE], details → <details>, AI blocks → > [!AI], math → $…$ / $$…$$).",
  "Page versions, knowledge-graph edges and search data are not in a ZIP export (use the JSON backup).",
  "Database views, relations, property options and row ids are only in workspace.json; the CSV holds the visible values.",
  "Reference extracts (quotes, page numbers, notes) and experiments are in workspace.json, not in references.bib.",
  "Pages in the trash are not exported.",
];

export function buildZip(set: ExportSet): { zip: JSZip; manifest: Record<string, unknown>; report: ExportReport } {
  const zip = new JSZip();
  const placed = assignPaths(set);
  const attById = new Map(set.attachments.map((a) => [a.id, a]));
  const attFiles = new Map<string, string>(); let bytes = 0; let attachmentBytes = 0;
  const notIncluded = new Map<string, ExportReport["notIncluded"][number]>(); const outside = new Set<string>(); let mentionsOutside = 0;
  const addAttachment = (id: string): string | null => {
    const a = attById.get(id);
    if (!a) { if (!notIncluded.has(id)) notIncluded.set(id, { type: "file-link", id, reason: "a page links to a file that was deleted or does not belong to this workspace; the link is kept as it was" }); return null; }
    if (!attFiles.has(id)) {
      const f = attachmentFile(a); let abs = ""; let ok = true; try { abs = absPath(a.storagePath); ok = fs.existsSync(abs); } catch { ok = false; }
      if (!ok) { notIncluded.set(id, { type: "attachment", id, filename: a.filename, pageId: a.pageId, reason: "the file is missing from data/uploads on the server (restore it from the encrypted backup)" }); return null; }
      bytes += a.size; attachmentBytes += a.size; if (bytes > ZIP_MAX_BYTES) throw new ExportTooLarge(bytes);
      zip.file(f, fs.createReadStream(abs), { date: a.createdAt }); attFiles.set(id, f);
    }
    return attFiles.get(id)!;
  };
  const dbByPage = new Map(set.databases.map((d) => [d.pageId, d]));
  const manifestPages: Record<string, unknown>[] = [];
  for (const { page, file, dir } of placed.values()) {
    const base = zipResolvers(set, placed, file, addAttachment);
    const md = pageMarkdown(set, page, { placed, resolvers: { mention: (id, label) => { const r = base.mention!(id, label); if (!r) { mentionsOutside++; outside.add(id); } return r; }, file: (src) => (attachmentIdOf(src) ? base.file!(src) : null) } });
    bytes += Buffer.byteLength(md); if (bytes > ZIP_MAX_BYTES) throw new ExportTooLarge(bytes);
    zip.file(file, md, { date: page.updatedAt });
    const d = dbByPage.get(page.id);
    if (d) { const { csv, orphanRows } = databaseCsv(set, d.id); zip.file(file.replace(/\.md$/, ".csv"), csv, { date: d.updatedAt }); if (orphanRows) notIncluded.set(`rows:${d.id}`, { type: "database-row", id: d.id, reason: `${orphanRows} row(s) of “${d.name}” have their page in the trash and are not exported` }); }
    manifestPages.push({ id: page.id, title: page.title, type: page.type, section: page.section, parentId: page.parentId, databaseId: page.databaseId, icon: page.icon, path: file, dir, tags: tagsOf(set, page), createdAt: page.createdAt, updatedAt: page.updatedAt });
  }
  // attachments not referenced from any page content but linked to a page in the set (and the PDFs of the references)
  for (const a of set.attachments) addAttachment(a.id);
  if (set.references.length) zip.file("references.bib", bibFile(set.references));
  const exportedAt = new Date().toISOString();
  const report: ExportReport = {
    format: "note-spboucher-ai/export-report/1", kind: set.rootId ? "subtree" : "workspace", exportedAt, rootId: set.rootId,
    counts: { pages: set.pages.length, databases: set.databases.length, rows: set.rows.length, attachments: attFiles.size, attachmentBytes, references: set.references.length, experiments: set.experiments.length, tasks: set.tasks.length, tags: set.tags.length },
    complete: notIncluded.size === 0, notIncluded: [...notIncluded.values()],
    unresolved: { mentionsOutsideExport: mentionsOutside, pagesOutsideExport: [...outside].slice(0, 500) },
    byDesign: BY_DESIGN,
  };
  const manifest = {
    format: JSON_FORMAT, kind: report.kind, exportedAt, app: "Note SPBoucher AI",
    workspace: { id: set.workspace.id, name: set.workspace.name, slug: set.workspace.slug }, rootId: set.rootId,
    counts: report.counts, complete: report.complete,
    pages: manifestPages,
    databases: set.databases.map((d) => ({ id: d.id, pageId: d.pageId, name: d.name, description: d.description, csv: placed.get(d.pageId)?.file.replace(/\.md$/, ".csv"), properties: set.properties.filter((p) => p.databaseId === d.id).map((p) => ({ id: p.id, name: p.name, type: p.type, config: p.config, position: p.position })), views: set.views.filter((v) => v.databaseId === d.id).map((v) => ({ id: v.id, name: v.name, type: v.type, config: v.config, isDefault: v.isDefault })), rows: set.rows.filter((r) => r.databaseId === d.id).map((r) => ({ id: r.id, pageId: r.pageId, path: placed.get(r.pageId)?.file, values: r.values, position: r.position })) })),
    attachments: [...attFiles.entries()].map(([id, path]) => { const a = attById.get(id)!; return { id, path, filename: a.filename, mime: a.mime, size: a.size, sha256: a.sha256, pageId: a.pageId, createdAt: a.createdAt }; }),
    // full reference rows: every BibTeX field plus what a .bib cannot carry (extracts, attached PDF, page)
    references: set.references.map((r) => ({ id: r.id, citeKey: r.citeKey, entryType: r.entryType, title: r.title, authors: r.authors, year: r.year, journal: r.journal, doi: r.doi, url: r.url, verified: r.verified, pageId: r.pageId, attachmentId: r.attachmentId, attachmentPath: r.attachmentId ? attFiles.get(r.attachmentId) ?? null : null, fields: r.fields })),
    experiments: set.experiments.map((e) => ({ id: e.id, pageId: e.pageId, name: e.name, status: e.status, params: e.params, metrics: e.metrics, datasetRef: e.datasetRef, repoUrl: e.repoUrl, notes: e.notes, startedAt: e.startedAt, finishedAt: e.finishedAt, createdAt: e.createdAt })),
    tasks: set.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, dueAt: t.dueAt, completedAt: t.completedAt, project: t.project, pageId: t.pageId })),
    tags: set.tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
  };
  zip.file("workspace.json", JSON.stringify(manifest, null, 2));
  zip.file("export-report.json", JSON.stringify(report, null, 2));
  return { zip, manifest, report };
}

export async function exportZip(wsId: string, rootId?: string | null): Promise<{ stream: ReadableStream; filename: string; report: ExportReport }> {
  const set = await loadExportSet(wsId, rootId);
  const { zip, report } = buildZip(set);
  const root = rootId ? set.pages.find((p) => p.id === rootId) : null;
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${slugify(root ? root.title : set.workspace.name) || "export"}-${stamp}.zip`;
  const pt = new PassThrough();
  zip.generateNodeStream({ type: "nodebuffer", streamFiles: true, compression: "DEFLATE", compressionOptions: { level: 6 } }).on("error", (e) => pt.destroy(e)).pipe(pt);
  return { stream: Readable.toWeb(pt) as unknown as ReadableStream, filename, report };
}
