import { z } from "zod";
import { handler, parseBody, uuid } from "@/lib/api";
import { updateExperiment, deleteExperiment, EXPERIMENT_STATUSES } from "@/lib/research/experiments";
import { audit } from "@/lib/audit";
const patchSchema = z.object({ pageId: uuid.nullable().optional(), name: z.string().min(1).max(300).optional(), status: z.enum(EXPERIMENT_STATUSES).optional(), params: z.record(z.string(), z.unknown()).optional(), metrics: z.record(z.string(), z.unknown()).optional(), datasetRef: z.string().max(2000).nullable().optional(), repoUrl: z.string().max(2000).nullable().optional(), notes: z.string().max(20_000).nullable().optional() });
export const PATCH = handler(async ({ req, ws, params, user }) => { const id = uuid.parse(params.id); const b = await parseBody(req, patchSchema); const e = await updateExperiment(ws.id, id, b); await audit(user.id, "experiment.update", { type: "experiment", id }, { keys: Object.keys(b) }); return Response.json(e); });
export const DELETE = handler(async ({ ws, params, user }) => { const id = uuid.parse(params.id); await deleteExperiment(ws.id, id); await audit(user.id, "experiment.delete", { type: "experiment", id }); return Response.json({ ok: true }); });
