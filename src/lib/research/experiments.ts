/** Experiments service (params/metrics jsonb, status planned|running|done|failed). */
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { HttpError } from "@/lib/auth/guard";
const E = schema.experiments;
export type ExperimentRow = typeof E.$inferSelect;
export const EXPERIMENT_STATUSES = ["planned", "running", "done", "failed"] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];
export interface ExperimentInput { pageId?: string | null; name: string; status?: ExperimentStatus; params?: Record<string, unknown>; metrics?: Record<string, unknown>; datasetRef?: string | null; repoUrl?: string | null; notes?: string | null }

export async function listExperiments(wsId: string, pageId?: string | null) {
  return db.select().from(E).where(and(eq(E.workspaceId, wsId), pageId ? eq(E.pageId, pageId) : undefined)).orderBy(asc(E.createdAt));
}
export async function createExperiment(wsId: string, input: ExperimentInput) {
  const [e] = await db.insert(E).values({ workspaceId: wsId, pageId: input.pageId ?? null, name: input.name.trim() || "Experiment", status: input.status ?? "planned", params: input.params ?? {}, metrics: input.metrics ?? {}, datasetRef: input.datasetRef ?? null, repoUrl: input.repoUrl ?? null, notes: input.notes ?? null, startedAt: input.status === "running" ? new Date() : null }).returning();
  return e;
}
export async function updateExperiment(wsId: string, id: string, patch: Partial<ExperimentInput>) {
  const [prev] = await db.select().from(E).where(and(eq(E.id, id), eq(E.workspaceId, wsId))); if (!prev) throw new HttpError(404, "Experiment not found");
  const set: Partial<ExperimentRow> = { updatedAt: new Date() };
  for (const k of ["pageId", "name", "status", "params", "metrics", "datasetRef", "repoUrl", "notes"] as const) if (patch[k] !== undefined) (set as any)[k] = patch[k];
  if (patch.status && patch.status !== prev.status) { if (patch.status === "running" && !prev.startedAt) set.startedAt = new Date(); if (patch.status === "done" || patch.status === "failed") set.finishedAt = new Date(); if (patch.status === "planned") { set.startedAt = null; set.finishedAt = null; } }
  const [e] = await db.update(E).set(set).where(eq(E.id, id)).returning(); return e;
}
export async function deleteExperiment(wsId: string, id: string) { await db.delete(E).where(and(eq(E.id, id), eq(E.workspaceId, wsId))); }
