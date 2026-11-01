import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { createPage } from "@/lib/pages/service";
import { workingPaperTemplate } from "@/lib/research/template";
import { PAPER_STATUSES } from "@/lib/research/overview";
import { audit } from "@/lib/audit";
/** POST { title?, status?, venue? } → new research page (section research) with the LaTeX-ready starter template. */
export const POST = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, z.object({ title: z.string().max(300).optional(), status: z.enum(PAPER_STATUSES).optional(), venue: z.string().max(200).optional() }));
  const title = b.title?.trim() || "New working paper";
  const p = await createPage(ws.id, { title, section: "research", type: "research", icon: "🔬", content: workingPaperTemplate(title), properties: { status: b.status ?? "planning", ...(b.venue ? { venue: b.venue } : {}), tags: ["working-paper"] } });
  await audit(user.id, "page.create", { type: "page", id: p.id }, { title: p.title, kind: "working-paper" });
  return Response.json(p, { status: 201 });
});
