/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/graph/schema.ts
 * Module           : lib
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

/** zod schemas of the graph 2.0 API (shared by the collection and item routes). */
import { z } from "zod";
import { REL_TYPES, NODE_KINDS2 } from "./relations";
const uuid = z.string().uuid();
const when = z.string().datetime({ offset: true }).nullable();
export const relationCreate = z.object({ id: uuid.optional(), fromId: uuid, toId: uuid, sourceKind: z.enum(NODE_KINDS2).optional(), targetKind: z.enum(NODE_KINDS2).optional(), relType: z.enum(REL_TYPES), note: z.string().max(2000).nullable().optional(), validFrom: when.optional(), validTo: when.optional(), sourceBlockId: z.string().max(64).nullable().optional(), targetBlockId: z.string().max(64).nullable().optional() });
export const relationPatch = z.object({ status: z.enum(["accepted", "rejected", "suggested"]).optional(), relType: z.enum(REL_TYPES).optional(), note: z.string().max(2000).nullable().optional(), validFrom: when.optional(), validTo: when.optional() });
export const conceptCreate = z.object({ id: uuid.optional(), name: z.string().trim().min(1).max(120), description: z.string().max(2000).nullable().optional(), pageIds: z.array(uuid).max(200).optional() });
export const conceptPatch = z.object({ name: z.string().trim().min(1).max(120).optional(), description: z.string().max(2000).nullable().optional(), status: z.enum(["accepted", "rejected", "suggested"]).optional(), addPages: z.array(uuid).max(200).optional(), removePages: z.array(uuid).max(200).optional(), pageLinks: z.array(z.object({ pageId: uuid, status: z.enum(["accepted", "rejected", "suggested"]) })).max(200).optional() });
export const toDate = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(v));
