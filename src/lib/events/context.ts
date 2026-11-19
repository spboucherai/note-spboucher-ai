/**
 * File: src/lib/events/context.ts
 * Description: who is acting (user / agent / ai / system) and from which device, carried implicitly through one request or job so the
 *   service layer can stamp journal events without threading two extra parameters through every function.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
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
