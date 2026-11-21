/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/databases/[id]/ai/config/route.ts
 * Module           : app
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-19
 * Last Modified    : 2026-11-19
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: contact@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

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
