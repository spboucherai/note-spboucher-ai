/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/tasks/schema.ts
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

/** zod schemas of the tasks API, shared by /api/tasks and /api/tasks/[id] (a Next route file may only export handlers). */
import { z } from "zod";
const uuid = z.string().uuid();
export const priority = z.enum(["low", "medium", "high"]);
/** ISO datetime with offset, or a bare ISO date (stored at 12:00 UTC of that day). `due` is an alias of `dueAt` (SPEC §4.2). */
const due = z.union([z.string().datetime({ offset: true }), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).nullable();
export const taskCreate = z.object({ id: uuid.optional(), title: z.string().trim().min(1).max(500), dueAt: due.optional(), due: due.optional(), priority: priority.optional(), project: z.string().trim().max(100).nullable().optional(), pageId: uuid.nullable().optional(), blockId: z.string().max(64).nullable().optional(), status: z.enum(["todo", "doing", "done"]).optional() });
export const taskPatch = taskCreate.omit({ id: true }).partial();
export const dueOf = (b: { dueAt?: string | null; due?: string | null }) => (b.dueAt !== undefined ? b.dueAt : b.due);

