/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/research/experiments/[id]/route.ts
 * Module           : app
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-01
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
import { updateExperiment, deleteExperiment, EXPERIMENT_STATUSES } from "@/lib/research/experiments";
import { audit } from "@/lib/audit";
const patchSchema = z.object({ pageId: uuid.nullable().optional(), name: z.string().min(1).max(300).optional(), status: z.enum(EXPERIMENT_STATUSES).optional(), params: z.record(z.string(), z.unknown()).optional(), metrics: z.record(z.string(), z.unknown()).optional(), datasetRef: z.string().max(2000).nullable().optional(), repoUrl: z.string().max(2000).nullable().optional(), notes: z.string().max(20_000).nullable().optional() });
export const PATCH = handler(async ({ req, ws, params, user }) => { const id = uuid.parse(params.id); const b = await parseBody(req, patchSchema); const e = await updateExperiment(ws.id, id, b); await audit(user.id, "experiment.update", { type: "experiment", id }, { keys: Object.keys(b) }); return Response.json(e); });
export const DELETE = handler(async ({ ws, params, user }) => { const id = uuid.parse(params.id); await deleteExperiment(ws.id, id); await audit(user.id, "experiment.delete", { type: "experiment", id }); return Response.json({ ok: true }); });
