/** GET /api/export?format=md|zip|json|csv|pdf|bib[&pageId=][&databaseId=] — authenticated downloads. */
import { and, eq, isNull } from "drizzle-orm";
import { handler, HttpError, uuid } from "@/lib/api";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { slugify } from "@/lib/utils";
import { fmtDate } from "@/lib/utils";
import { loadExportSet, pageMarkdown, standaloneResolvers, docToHtml, printHtml, databaseCsv, workspaceJson, exportZip, ExportTooLarge, tagsOf, rowValuesByName } from "@/lib/export";
import { formatBibtex, fieldsOf } from "@/lib/research/bibtex";
import type { PMNode } from "@/lib/editor/text";

const dispo = (name: string, inline = false) => `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`;
const stamp = () => new Date().toISOString().slice(0, 10);

export const GET = handler(async ({ req, ws, user }) => {
  const u = new URL(req.url); const format = u.searchParams.get("format") ?? "zip";
  const pageId = u.searchParams.get("pageId") ? uuid.parse(u.searchParams.get("pageId")) : null;
  const databaseId = u.searchParams.get("databaseId") ? uuid.parse(u.searchParams.get("databaseId")) : null;
  const appUrl = (process.env.APP_URL ?? u.origin).replace(/\/$/, "");
  await audit(user.id, "export", pageId ? { type: "page", id: pageId } : databaseId ? { type: "database", id: databaseId } : { type: "workspace", id: ws.id }, { format });
  try {
    switch (format) {
      case "zip": { const { stream, filename } = await exportZip(ws.id, pageId); return new Response(stream, { headers: { "content-type": "application/zip", "content-disposition": dispo(filename), "cache-control": "no-store" } }); }
      case "json": { const data = await workspaceJson(ws.id, { versions: u.searchParams.get("versions") !== "0" }); return new Response(JSON.stringify(data), { headers: { "content-type": "application/json", "content-disposition": dispo(`${slugify(ws.name) || "workspace"}-backup-${stamp()}.json`), "cache-control": "no-store" } }); }
      case "md": {
        if (!pageId) throw new HttpError(400, "pageId required for md");
        const set = await loadExportSet(ws.id, pageId); const page = set.pages.find((p) => p.id === pageId)!;
        const md = pageMarkdown(set, page, { resolvers: standaloneResolvers(appUrl) });
        return new Response(md, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": dispo(`${slugify(page.title) || "page"}.md`) } });
      }
      case "csv": {
        let dbId = databaseId;
        if (!dbId && pageId) { const [d] = await db.select({ id: schema.databases.id }).from(schema.databases).where(and(eq(schema.databases.pageId, pageId), isNull(schema.databases.deletedAt))); dbId = d?.id ?? null; }
        if (!dbId) throw new HttpError(400, "databaseId (or the pageId of a database page) required for csv");
        const [d] = await db.select({ pageId: schema.databases.pageId }).from(schema.databases).where(and(eq(schema.databases.id, dbId), eq(schema.databases.workspaceId, ws.id))); if (!d) throw new HttpError(404, "Database not found");
        const set = await loadExportSet(ws.id, d.pageId); const { name, csv } = databaseCsv(set, dbId);
        return new Response("﻿" + csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": dispo(`${slugify(name) || "database"}.csv`) } });
      }
      case "bib": {
        const set = await loadExportSet(ws.id, pageId);
        const bib = set.references.slice().sort((a, b) => a.citeKey.localeCompare(b.citeKey)).map((r) => r.bibtex ?? formatBibtex({ citeKey: r.citeKey, entryType: r.entryType, fields: fieldsOf(r) })).join("\n\n") + (set.references.length ? "\n" : "");
        return new Response(bib, { headers: { "content-type": "application/x-bibtex; charset=utf-8", "content-disposition": dispo("references.bib") } });
      }
      case "pdf": case "html": {
        if (!pageId) throw new HttpError(400, "pageId required for pdf");
        const set = await loadExportSet(ws.id, pageId); const page = set.pages.find((p) => p.id === pageId)!;
        const { html, hasMath } = docToHtml(page.content as PMNode, { mention: (id) => `${appUrl}/p/${id}`, file: (src) => (src.startsWith("/api/files/") ? src : null) });
        const props = { ...(rowValuesByName(set, page) ?? {}), ...(Object.fromEntries(Object.entries(page.properties as Record<string, unknown>).filter(([k]) => k !== "tags"))) };
        const tags = tagsOf(set, page);
        const body = printHtml({ title: page.title, icon: page.icon, meta: [`${page.section}`, `Updated ${fmtDate(page.updatedAt, { dateStyle: "medium", timeStyle: "short" })}`, `${page.wordCount} words`, ...(tags.length ? [`Tags: ${tags.join(", ")}`] : [])], props, bodyHtml: html, hasMath, footer: `${ws.name} · ${page.title} · exported ${fmtDate(new Date(), { dateStyle: "long" })} · ${appUrl}/p/${page.id}`, autoPrint: u.searchParams.get("print") === "1" });
        return new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "content-disposition": dispo(`${slugify(page.title) || "page"}.html`, true), "cache-control": "no-store", "x-frame-options": "DENY" } });
      }
      default: throw new HttpError(400, "format must be one of md, zip, json, csv, pdf, bib");
    }
  } catch (e) { if (e instanceof ExportTooLarge) throw new HttpError(413, e.message); throw e; }
});
