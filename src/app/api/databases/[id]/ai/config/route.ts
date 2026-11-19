import { z } from "zod";
import { handler, parseBody, uuid } from "@/lib/api";
import { aiConfigSchema, listAiConfig, setAiConfig, AI_TASKS } from "@/lib/ai/properties";
import { audit } from "@/lib/audit";
/**
 * Smart database properties — configuration of the AI columns of a database.
 * GET → `{tasks, properties:[{propertyId, name, ai:{task, prompt, choices, model, autoRun, managed}, problem, runs:{queued, done, failed, skipped, costUsd, lastAt}}]}`.
 * PUT `{propertyId, ai:{…partial…}}` → merged and validated configuration of one AI property.
 */
export const GET = handler(async ({ ws, params }) => Response.json({ tasks: AI_TASKS, properties: await listAiConfig(ws.id, params.id) }));
export const PUT = handler(async ({ ws, params, req, user }) => {
  const b = await parseBody(req, z.object({ propertyId: uuid, ai: aiConfigSchema }));
  const r = await setAiConfig(ws.id, params.id, b.propertyId, b.ai);
  await audit(user.id, "database.property.ai_config", { type: "property", id: b.propertyId }, { task: r.ai.task, autoRun: r.ai.autoRun, managed: r.ai.managed, model: r.ai.model });
  return Response.json(r);
});
