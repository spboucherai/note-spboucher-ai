/**
 * GET /api/export?format=md|zip|json|csv|pdf|html|bib[&pageId=][&databaseId=] — authenticated downloads.
 *
 * Whole-workspace exports (format=zip without pageId, format=json) hand over everything at once: they require a passkey verification
 * younger than 5 minutes (`reauth_required` otherwise). A browser cannot run a passkey ceremony during a plain download navigation, so the
 * UI first calls `…&check=1` (JSON `{ ok: true }`, nothing exported) through `withFreshAuth`, then navigates to the real URL.
 *
 * Every export is audited with its counts (never content). What could not be included is explicit: `export-report.json` in a ZIP, a
 * top-level `report` in the JSON backup, the `x-export-report` header on single-file formats.
 */
import { and, eq, isNull } from "drizzle-orm";
import { handler, HttpError, uuid, requireFresh } from "@/lib/api";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { slugify } from "@/lib/utils";
import { fmtDate } from "@/lib/utils";
import { loadExportSet, pageMarkdown, standaloneResolvers, docToHtml, printHtml, databaseCsv, workspaceJson, exportZip, ExportTooLarge, ExportNotFound, tagsOf, rowValuesByName, EXPORT_FORMATS, badFormatMessage } from "@/lib/export";
import { bibFile } from "@/lib/research/bibtex";
import type { PMNode } from "@/lib/editor/text";

const dispo = (name: string, inline = false) => `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`;
const stamp = () => new Date().toISOString().slice(0, 10);
/** ASCII-only JSON for a response header (counts and flags, no titles). */
const reportHeader = (r: Record<string, unknown>) => JSON.stringify(r).replace(/[^\x20-\x7e]/g, "?");
/** Formats that export the whole workspace in one file → fresh passkey. */
const sensitive = (format: string, pageId: string | null) => format === "json" || (format === "zip" && !pageId);

export const GET = handler(async ({ req, ws, user }) => {
  const u = new URL(req.url); const format = u.searchParams.get("format") ?? "zip";
  if (!EXPORT_FORMATS.includes(format)) throw new HttpError(400, badFormatMessage());
  const idOf = (k: string) => { const v = u.searchParams.get(k); if (!v) return null; const p = uuid.safeParse(v); if (!p.success) throw new HttpError(400, `Invalid ${k}`); return p.data; };
  const pageId = idOf("pageId"); const databaseId = idOf("databaseId");
  const appUrl = (process.env.APP_URL ?? u.origin).replace(/\/$/, "");
  const whole = sensitive(format, pageId);
  if (whole) requireFresh(user);
  if (u.searchParams.get("check") === "1") return Response.json({ ok: true, format, fresh: whole });
  const target = pageId ? { type: "page", id: pageId } : databaseId ? { type: "database", id: databaseId } : { type: "workspace", id: ws.id };
  const log = (detail: Record<string, unknown>) => audit(user.id, "export", target, { format, scope: pageId ? (format === "zip" ? "subtree" : "page") : databaseId ? "database" : "workspace", ...detail });
  try {
    switch (format) {
      case "zip": {
        const { stream, filename, report } = await exportZip(ws.id, pageId);
        await log({ ...report.counts, complete: report.complete, notIncluded: report.notIncluded.length, mentionsOutside: report.unresolved.mentionsOutsideExport });
        return new Response(stream, { headers: { "content-type": "application/zip", "content-disposition": dispo(filename), "cache-control": "no-store", "x-export-report": reportHeader({ ...report.counts, complete: report.complete, notIncluded: report.notIncluded.length }) } });
      }
      case "json": {
        const data = await workspaceJson(ws.id, { versions: u.searchParams.get("versions") !== "0" });
        await log({ ...data.counts, complete: data.report.complete, missingAttachmentFiles: data.report.missingAttachmentFiles.count });
        return new Response(JSON.stringify(data), { headers: { "content-type": "application/json", "content-disposition": dispo(`${slugify(ws.name) || "workspace"}-backup-${stamp()}.json`), "cache-control": "no-store", "x-export-report": reportHeader({ pages: data.counts.pages, attachments: data.counts.attachments, complete: data.report.complete, missingAttachmentFiles: data.report.missingAttachmentFiles.count }) } });
      }
      case "md": {
        if (!pageId) throw new HttpError(400, "pageId required for md");
        const set = await loadExportSet(ws.id, pageId); const page = set.pages.find((p) => p.id === pageId)!;
        const md = pageMarkdown(set, page, { resolvers: standaloneResolvers(appUrl) });
        const files = new Set([...JSON.stringify(page.content ?? {}).matchAll(/\/api\/files\/([0-9a-f-]{36})/g)].map((m) => m[1])).size;
        await log({ pages: 1, words: page.wordCount, linkedFiles: files });
        // a single .md cannot carry files: they stay links to the app (use the subtree ZIP to take them along)
        return new Response(md, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": dispo(`${slugify(page.title) || "page"}.md`), "x-export-report": reportHeader({ pages: 1, filesKeptAsLinks: files, subpagesNotIncluded: set.pages.length - 1 }) } });
      }
      case "csv": {
        let dbId = databaseId;
        if (!dbId && pageId) { const [d] = await db.select({ id: schema.databases.id }).from(schema.databases).where(and(eq(schema.databases.pageId, pageId), eq(schema.databases.workspaceId, ws.id), isNull(schema.databases.deletedAt))); dbId = d?.id ?? null; }
        if (!dbId) throw new HttpError(400, "databaseId (or the pageId of a database page) required for csv");
        const [d] = await db.select({ pageId: schema.databases.pageId }).from(schema.databases).where(and(eq(schema.databases.id, dbId), eq(schema.databases.workspaceId, ws.id), isNull(schema.databases.deletedAt))); if (!d) throw new HttpError(404, "Database not found");
        const set = await loadExportSet(ws.id, d.pageId); const { name, csv, rows, columns, orphanRows } = databaseCsv(set, dbId);
        await log({ rows, columns, rowsInTrash: orphanRows });
        return new Response("﻿" + csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": dispo(`${slugify(name) || "database"}.csv`), "x-export-report": reportHeader({ rows, columns, rowsInTrashNotExported: orphanRows }) } });
      }
      case "bib": {
        const set = await loadExportSet(ws.id, pageId);
        await log({ references: set.references.length });
        return new Response(bibFile(set.references), { headers: { "content-type": "application/x-bibtex; charset=utf-8", "content-disposition": dispo("references.bib"), "x-export-report": reportHeader({ references: set.references.length }) } });
      }
      default: { // pdf | html: print view
        if (!pageId) throw new HttpError(400, "pageId required for pdf");
        const set = await loadExportSet(ws.id, pageId); const page = set.pages.find((p) => p.id === pageId)!;
        const { html, hasMath } = docToHtml(page.content as PMNode, { mention: (id) => `${appUrl}/p/${id}`, file: (src) => (src.startsWith("/api/files/") ? src : null) });
        const props = { ...(rowValuesByName(set, page) ?? {}), ...(Object.fromEntries(Object.entries(page.properties as Record<string, unknown>).filter(([k]) => k !== "tags"))) };
        const tags = tagsOf(set, page);
        const body = printHtml({ title: page.title, icon: page.icon, meta: [`${page.section}`, `Updated ${fmtDate(page.updatedAt, { dateStyle: "medium", timeStyle: "short" })}`, `${page.wordCount} words`, ...(tags.length ? [`Tags: ${tags.join(", ")}`] : [])], props, bodyHtml: html, hasMath, footer: `${ws.name} · ${page.title} · exported ${fmtDate(new Date(), { dateStyle: "long" })} · ${appUrl}/p/${page.id}`, autoPrint: u.searchParams.get("print") === "1" });
        await log({ pages: 1, words: page.wordCount, math: hasMath });
        return new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "content-disposition": dispo(`${slugify(page.title) || "page"}.html`, true), "cache-control": "no-store", "x-frame-options": "DENY" } });
      }
    }
  } catch (e) {
    if (e instanceof ExportTooLarge) { await log({ failed: "too_large", bytes: e.bytes }); throw new HttpError(413, e.message, "export_too_large"); }
    if (e instanceof ExportNotFound) throw new HttpError(404, e.message, "not_found");
    throw e;
  }
});
