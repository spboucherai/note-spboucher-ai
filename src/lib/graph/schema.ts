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
