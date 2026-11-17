/** PDF → page: original attached as a file block, extracted text as paragraphs (one heading per PDF page). */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { PMNode } from "@/lib/editor/text";
import { createAttachment, createPage, tick, type ImportCtx } from "./pages";

export async function importPdf(ctx: ImportCtx, buf: Buffer, opts: { filename: string; parentId?: string | null }) {
  const att = await createAttachment(ctx, buf, opts.filename, "application/pdf", null, "pdf");
  await tick(ctx, "PDF stored");
  let pages: { num: number; text: string }[] = [];
  try { const { PDFParse } = await import("pdf-parse"); const p = new PDFParse({ data: new Uint8Array(buf) }); const r = await p.getText(); await p.destroy().catch(() => {}); pages = (r.pages ?? []).map((pg: any, i: number) => ({ num: pg.num ?? i + 1, text: String(pg.text ?? "") })); if (!pages.length && r.text) pages = [{ num: 1, text: r.text }]; } catch (e) { ctx.stats.skipped.push(`The text of the PDF could not be extracted (${String((e as Error).message).slice(0, 120)}) — the file itself is attached`); }
  const title = opts.filename.replace(/\.pdf$/i, "");
  const content: PMNode[] = [{ type: "fileBlock", attrs: { src: `/api/files/${att.id}`, name: opts.filename, size: buf.length, mime: "application/pdf", attachmentId: att.id } }];
  const para = (t: string): PMNode => ({ type: "paragraph", content: [{ type: "text", text: t }] });
  let truncated = 0;
  for (const pg of pages) {
    const paras = pg.text.replace(/\r/g, "").split(/\n\s*\n/).map((s) => s.replace(/[ \t]*\n[ \t]*/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
    if (!paras.length) continue;
    if (pages.length > 1) content.push({ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: `Page ${pg.num}` }] });
    for (const t of paras) { if (t.length > 20_000) truncated++; content.push(para(t.slice(0, 20_000))); }
  }
  if (truncated) ctx.stats.skipped.push(`${truncated} very long paragraph(s) were cut at 20 000 characters in the page (the attached PDF is complete)`);
  if (content.length === 1) { content.push(para("(no extractable text — scanned PDF?)")); ctx.stats.skipped.push("No text layer found (scanned PDF?) — only the file is attached"); }
  const page = await createPage(ctx, { key: "pdf", title, parentId: opts.parentId ?? null, section: "documents", content: { type: "doc", content }, properties: { source: "pdf-import", pages: pages.length } });
  await db.update(schema.attachments).set({ pageId: page.id }).where(eq(schema.attachments.id, att.id));
  await tick(ctx, `Page ${title}`);
  return { page, attachmentId: att.id, pages: pages.length };
}
