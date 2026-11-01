import { z } from "zod";
import { handler, parseBody, uuid } from "@/lib/api";
import { listExperiments, createExperiment, EXPERIMENT_STATUSES } from "@/lib/research/experiments";
import { audit } from "@/lib/audit";
export const expSchema = z.object({ pageId: uuid.nullable().optional(), name: z.string().min(1).max(300), status: z.enum(EXPERIMENT_STATUSES).optional(), params: z.record(z.string(), z.unknown()).optional(), metrics: z.record(z.string(), z.unknown()).optional(), datasetRef: z.string().max(2000).nullable().optional(), repoUrl: z.string().max(2000).nullable().optional(), notes: z.string().max(20_000).nullable().optional() });
export const GET = handler(async ({ req, ws }) => Response.json(await listExperiments(ws.id, new URL(req.url).searchParams.get("pageId"))));
export const POST = handler(async ({ req, ws, user }) => { const b = await parseBody(req, expSchema); const e = await createExperiment(ws.id, b); await audit(user.id, "experiment.create", { type: "experiment", id: e.id }, { name: e.name }); return Response.json(e, { status: 201 }); });
