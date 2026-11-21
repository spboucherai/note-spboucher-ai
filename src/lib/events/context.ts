/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/events/context.ts
 * Description      : who is acting (user / agent / ai / system) and from which
 *                    device, carried implicitly through one request or job so
 *                    the service layer can stamp journal events without
 *                    threading two extra parameters through every function.
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

import { AsyncLocalStorage } from "node:async_hooks";
export type Actor = "user" | "agent" | "ai" | "system";
export interface ActorCtx { actor: Actor; device?: string | null }
const g = globalThis as unknown as { __noteActorCtx?: AsyncLocalStorage<ActorCtx> };
const store = g.__noteActorCtx ?? (g.__noteActorCtx = new AsyncLocalStorage<ActorCtx>());
/** Run `fn` with an actor; nested calls override (an agent proposal applied inside a user request is stamped `agent`). */
export const withActor = <T>(ctx: ActorCtx, fn: () => T): T => store.run({ device: store.getStore()?.device ?? null, ...ctx }, fn);
/** Outside any request or job (CLI, tests calling a service directly) events are stamped `system`. */
export const currentActor = (): ActorCtx => store.getStore() ?? { actor: "system", device: null };
