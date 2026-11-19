import fs from "node:fs";
import JSZip from "jszip";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { handler, uuid, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { exportProjectLatex } from "@/lib/research/latex";
import { absPath } from "@/lib/files/storage";
import { audit } from "@/lib/audit";
export const maxDuration = 120;
const slug = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "project";
const FIGURES_MAX = 150 * 1024 * 1024;
/**
 * GET ?projectId=<page id>[&format=tex|json|zip][&inline=1] — LaTeX article skeleton of a research project (SPEC §4.14).
 *   tex  (default) main.tex as `application/x-tex`; headers `x-export-report` (counts) and `x-bib-url` (the .bib companion)
 *   json `{title, tex, bib, citeKeys, missingKeys, missingRefs, figures:[{attachmentId, name, file}], sections, hypotheses, experiments, unknownNodes}`
 *   zip  main.tex + references.bib + figures/<file> (the real attachments, when present on disk) + export-report.json
 * Sections come from the project's pages (root first, then descendants in tree order); equations are kept as LaTeX; figures are
 * \\includegraphics placeholders named after the attachment; \\cite keys are preserved and listed. No AI is involved.
 */
export const GET = handler(async ({ req, ws, user }) => {
  const u = new URL(req.url).searchParams; const pid = uuid.safeParse(u.get("projectId") ?? ""); if (!pid.success) throw new HttpError(400, "projectId is required (a page id)", "bad_id");
  const format = u.get("format") ?? "tex"; if (!["tex", "json", "zip"].includes(format)) throw new HttpError(400, "Unknown format (tex, json, zip)", "bad_format");
  const x = await exportProjectLatex(ws.id, pid.data, { author: user.displayName ?? null });
  const report = { pages: x.pageIds.length, sections: x.sections, citeKeys: x.citeKeys.length, missingKeys: x.missingKeys.length, missingRefs: x.missingRefs.length, figures: x.figures.length, hypotheses: x.hypotheses, experiments: x.experiments, unknownNodes: x.unknownNodes };
  await audit(user.id, "export", { type: "page", id: pid.data }, { format: `latex-${format}`, ...report });
  const name = slug(x.title); const bibUrl = `/api/research/references/export.bib?projectId=${pid.data}`;
  if (format === "json") { const { pageIds: _p, ...rest } = x; return Response.json({ projectId: pid.data, ...rest, bibUrl }); }
  if (format === "tex") return new Response(x.tex, { headers: { "content-type": "application/x-tex; charset=utf-8", "x-export-report": JSON.stringify(report), "x-bib-url": bibUrl, ...(u.get("inline") === "1" ? {} : { "content-disposition": `attachment; filename="${name}.tex"` }) } });
  const zip = new JSZip(); zip.file("main.tex", x.tex); zip.file("references.bib", x.bib || "% no reference in this project\n");
  const ids = x.figures.map((f) => f.attachmentId).filter((i): i is string => Boolean(i)); const included: string[] = []; const missing: string[] = []; let bytes = 0;
  const atts = ids.length ? await db.select().from(schema.attachments).where(and(eq(schema.attachments.workspaceId, ws.id), inArray(schema.attachments.id, ids), isNull(schema.attachments.deletedAt))) : [];
  for (const f of x.figures) {
    const a = atts.find((r) => r.id === f.attachmentId); const p = a ? absPath(a.storagePath) : null;
    if (a && p && fs.existsSync(p) && bytes + a.size <= FIGURES_MAX) { zip.file(`figures/${f.file}`, fs.createReadStream(p)); bytes += a.size; included.push(f.file); } else missing.push(f.file);
  }
  zip.file("export-report.json", JSON.stringify({ ...report, figuresIncluded: included, figuresMissing: missing, missingKeyList: x.missingKeys }, null, 2));
  const buf = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return new Response(buf as unknown as BodyInit, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${name}-latex.zip"`, "x-export-report": JSON.stringify({ ...report, figuresIncluded: included.length, figuresMissing: missing.length }) } });
});
