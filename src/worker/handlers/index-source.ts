import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "../../db/index";
import { indexSource, removeSource } from "../../lib/search/index";
import { ensureBlockIds } from "../../lib/editor/text";
/** Pages written before block ids were assigned server-side: add them once, in place. The version is NOT bumped (no text changes, and an open editor must not see a conflict). */
async function withIds(p: { id: string; content: unknown }) { const r = ensureBlockIds(p.content as any); if (r.changed) await db.update(schema.pages).set({ content: r.doc as any }).where(eq(schema.pages.id, p.id)); return r.doc; }
export async function handleIndex(d: { sourceType: "page" | "attachment" | "row"; sourceId: string; workspaceId: string }) {
  if (d.sourceType === "page") {
    const [p] = await db.select().from(schema.pages).where(eq(schema.pages.id, d.sourceId));
    if (!p || p.deletedAt) { await removeSource("page", d.sourceId); return { removed: true }; }
    return indexSource(p.workspaceId, "page", p.id, p.title, { doc: await withIds(p) }, p.id);
  }
  if (d.sourceType === "attachment") {
    const [a] = await db.select().from(schema.attachments).where(eq(schema.attachments.id, d.sourceId));
    if (!a || a.deletedAt || !a.extractedText) { await removeSource("attachment", d.sourceId); return { removed: true }; }
    return indexSource(a.workspaceId, "attachment", a.id, a.filename, { text: `${a.filename}\n\n${a.extractedText}` }, a.pageId);
  }
  return { ignored: true };
}
export async function handleReindexAll(d: { workspaceId: string }) {
  const pages = await db.select({ id: schema.pages.id, title: schema.pages.title, content: schema.pages.content }).from(schema.pages).where(and(eq(schema.pages.workspaceId, d.workspaceId), isNull(schema.pages.deletedAt)));
  let n = 0; for (const p of pages) { await indexSource(d.workspaceId, "page", p.id, p.title, { doc: await withIds(p) }, p.id); n++; }
  const atts = await db.select().from(schema.attachments).where(and(eq(schema.attachments.workspaceId, d.workspaceId), isNull(schema.attachments.deletedAt)));
  for (const a of atts) if (a.extractedText) { await indexSource(d.workspaceId, "attachment", a.id, a.filename, { text: `${a.filename}\n\n${a.extractedText}` }, a.pageId); n++; }
  return { indexed: n };
}
