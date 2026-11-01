import { handler } from "@/lib/api";
import { exportBibtex } from "@/lib/research/references";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
/** GET ?pageId=<id> → references.bib of that page; without pageId → whole library. ?inline=1 returns text without attachment header. */
export const GET = handler(async ({ req, ws }) => {
  const u = new URL(req.url); const pageId = u.searchParams.get("pageId"); const inline = u.searchParams.get("inline") === "1";
  const bib = await exportBibtex(ws.id, pageId || null);
  let name = "library";
  if (pageId) { const [p] = await db.select({ title: schema.pages.title }).from(schema.pages).where(eq(schema.pages.id, pageId)); name = (p?.title ?? "references").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "references"; }
  return new Response(bib, { headers: { "content-type": "application/x-bibtex; charset=utf-8", ...(inline ? {} : { "content-disposition": `attachment; filename="${name}.bib"` }) } });
});
