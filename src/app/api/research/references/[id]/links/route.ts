import { handler, uuid } from "@/lib/api";
import { referenceLinks } from "@/lib/research/references";
/** GET → { attached, citing[], experiments[], pdf } : the page a reference lives on, the pages whose text cites its key, their experiments, its PDF. */
export const GET = handler(async ({ ws, params }) => Response.json(await referenceLinks(ws.id, uuid.parse(params.id))));
