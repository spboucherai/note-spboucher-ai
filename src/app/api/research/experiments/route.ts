/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/research/experiments/route.ts
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
import { listExperiments, createExperiment, EXPERIMENT_STATUSES } from "@/lib/research/experiments";
import { audit } from "@/lib/audit";
export const expSchema = z.object({ pageId: uuid.nullable().optional(), name: z.string().min(1).max(300), status: z.enum(EXPERIMENT_STATUSES).optional(), params: z.record(z.string(), z.unknown()).optional(), metrics: z.record(z.string(), z.unknown()).optional(), datasetRef: z.string().max(2000).nullable().optional(), repoUrl: z.string().max(2000).nullable().optional(), notes: z.string().max(20_000).nullable().optional() });
export const GET = handler(async ({ req, ws }) => Response.json(await listExperiments(ws.id, new URL(req.url).searchParams.get("pageId"))));
export const POST = handler(async ({ req, ws, user }) => { const b = await parseBody(req, expSchema); const e = await createExperiment(ws.id, b); await audit(user.id, "experiment.create", { type: "experiment", id: e.id }, { name: e.name }); return Response.json(e, { status: 201 }); });
