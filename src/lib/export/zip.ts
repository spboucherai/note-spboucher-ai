/**
 * Workspace / subtree → ZIP (streamed with jszip generateNodeStream; attachments are streamed from disk, never buffered).
 * Layout: <parents…>/<slug>.md, children under <slug>/, databases as <slug>.csv + <slug>/<row>.md, attachments/, references.bib, workspace.json.
 */
import fs from "node:fs";
import { PassThrough, Readable } from "node:stream";
import JSZip from "jszip";
import { absPath } from "@/lib/files/storage";
import { formatBibtex, fieldsOf } from "@/lib/research/bibtex";
import { slugify } from "@/lib/utils";
import { assignPaths, attachmentFile, loadExportSet, tagsOf, type ExportSet } from "./data";
import { pageMarkdown, zipResolvers } from "./markdown";
import { databaseCsv } from "./csv";
import { JSON_FORMAT } from "./json";

/** jszip has no zip64 support → hard cap; the JSON export + per-subtree ZIPs are the escape hatch. */
export const ZIP_MAX_BYTES = Number(process.env.EXPORT_MAX_BYTES ?? 500 * 1024 * 1024);
export class ExportTooLarge extends Error { constructor(public bytes: number) { super(`Export too large (${(bytes / 1048576).toFixed(0)} MB > ${(ZIP_MAX_BYTES / 1048576).toFixed(0)} MB). Export subtrees separately or use the JSON backup.`); } }

export function buildZip(set: ExportSet): { zip: JSZip; manifest: Record<string, unknown> } {
  const zip = new JSZip();
  const placed = assignPaths(set);
  const attById = new Map(set.attachments.map((a) => [a.id, a]));
  const attFiles = new Map<string, string>(); let bytes = 0;
  const addAttachment = (id: string): string | null => {
    const a = attById.get(id); if (!a) return null;
    if (!attFiles.has(id)) { const f = attachmentFile(a); let abs: string; try { abs = absPath(a.storagePath); } catch { return null; } if (!fs.existsSync(abs)) return null; bytes += a.size; if (bytes > ZIP_MAX_BYTES) throw new ExportTooLarge(bytes); zip.file(f, fs.createReadStream(abs), { date: a.createdAt }); attFiles.set(id, f); }
    return attFiles.get(id)!;
  };
  const dbByPage = new Map(set.databases.map((d) => [d.pageId, d]));
  const manifestPages: Record<string, unknown>[] = [];
  for (const { page, file, dir } of placed.values()) {
    const md = pageMarkdown(set, page, { placed, resolvers: zipResolvers(set, placed, file, addAttachment) });
    bytes += Buffer.byteLength(md); if (bytes > ZIP_MAX_BYTES) throw new ExportTooLarge(bytes);
    zip.file(file, md, { date: page.updatedAt });
    const d = dbByPage.get(page.id);
    if (d) { const { csv } = databaseCsv(set, d.id); zip.file(file.replace(/\.md$/, ".csv"), csv, { date: d.updatedAt }); }
    manifestPages.push({ id: page.id, title: page.title, type: page.type, section: page.section, parentId: page.parentId, databaseId: page.databaseId, icon: page.icon, path: file, dir, tags: tagsOf(set, page), createdAt: page.createdAt, updatedAt: page.updatedAt });
  }
  // attachments not referenced from any page content but linked to a page in the set
  for (const a of set.attachments) addAttachment(a.id);
  if (set.references.length) zip.file("references.bib", set.references.slice().sort((a, b) => a.citeKey.localeCompare(b.citeKey)).map((r) => r.bibtex ?? formatBibtex({ citeKey: r.citeKey, entryType: r.entryType, fields: fieldsOf(r) })).join("\n\n") + "\n");
  const manifest = {
    format: JSON_FORMAT, kind: set.rootId ? "subtree" : "workspace", exportedAt: new Date().toISOString(), app: "Note SPBoucher AI",
    workspace: { id: set.workspace.id, name: set.workspace.name, slug: set.workspace.slug }, rootId: set.rootId,
    counts: { pages: set.pages.length, databases: set.databases.length, rows: set.rows.length, attachments: attFiles.size, references: set.references.length, tasks: set.tasks.length },
    pages: manifestPages,
    databases: set.databases.map((d) => ({ id: d.id, pageId: d.pageId, name: d.name, description: d.description, csv: placed.get(d.pageId)?.file.replace(/\.md$/, ".csv"), properties: set.properties.filter((p) => p.databaseId === d.id).map((p) => ({ id: p.id, name: p.name, type: p.type, config: p.config, position: p.position })), views: set.views.filter((v) => v.databaseId === d.id).map((v) => ({ id: v.id, name: v.name, type: v.type, config: v.config, isDefault: v.isDefault })), rows: set.rows.filter((r) => r.databaseId === d.id).map((r) => ({ id: r.id, pageId: r.pageId, path: placed.get(r.pageId)?.file, values: r.values, position: r.position })) })),
    attachments: [...attFiles.entries()].map(([id, path]) => { const a = attById.get(id)!; return { id, path, filename: a.filename, mime: a.mime, size: a.size, sha256: a.sha256, pageId: a.pageId, createdAt: a.createdAt }; }),
    tasks: set.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, dueAt: t.dueAt, completedAt: t.completedAt, project: t.project, pageId: t.pageId })),
    tags: set.tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
  };
  zip.file("workspace.json", JSON.stringify(manifest, null, 2));
  return { zip, manifest };
}

export async function exportZip(wsId: string, rootId?: string | null): Promise<{ stream: ReadableStream; filename: string }> {
  const set = await loadExportSet(wsId, rootId);
  const { zip } = buildZip(set);
  const root = rootId ? set.pages.find((p) => p.id === rootId) : null;
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${slugify(root ? root.title : set.workspace.name) || "export"}-${stamp}.zip`;
  const pt = new PassThrough();
  zip.generateNodeStream({ type: "nodebuffer", streamFiles: true, compression: "DEFLATE", compressionOptions: { level: 6 } }).on("error", (e) => pt.destroy(e)).pipe(pt);
  return { stream: Readable.toWeb(pt) as unknown as ReadableStream, filename };
}
