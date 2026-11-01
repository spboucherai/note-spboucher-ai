import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { db, schema } from "@/db";
import { and, eq } from "drizzle-orm";
import { audit } from "@/lib/audit";
const KEY = "compare.votes";
async function votes(): Promise<Record<string, { model: string; at: string }>> { const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, KEY)); return (row?.value as any) ?? {}; }
/** GET → { votes: { [comparisonId]: { model, at } }, tally: { [model]: wins } } */
export const GET = handler(async () => {
  const v = await votes(); const tally: Record<string, number> = {}; for (const x of Object.values(v)) tally[x.model] = (tally[x.model] ?? 0) + 1;
  return Response.json({ votes: v, tally });
});
/** POST { comparisonId, model | null } → stores "best answer" vote for a saved comparison in settings `compare.votes`. */
export const POST = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, z.object({ comparisonId: z.string().uuid(), model: z.string().max(120).nullable() }));
  const [c] = await db.select({ id: schema.aiComparisons.id, models: schema.aiComparisons.models }).from(schema.aiComparisons).where(and(eq(schema.aiComparisons.id, b.comparisonId), eq(schema.aiComparisons.workspaceId, ws.id)));
  if (!c) return Response.json({ error: "Comparison not found" }, { status: 404 });
  if (b.model && !c.models.includes(b.model)) return Response.json({ error: "Model not part of this comparison" }, { status: 400 });
  const v = await votes(); if (b.model) v[c.id] = { model: b.model, at: new Date().toISOString() }; else delete v[c.id];
  await db.insert(schema.settings).values({ key: KEY, value: v }).onConflictDoUpdate({ target: schema.settings.key, set: { value: v, updatedAt: new Date() } });
  await audit(user.id, "ai.compare_vote", { type: "comparison", id: c.id }, { model: b.model });
  return Response.json({ ok: true, votes: v });
});
