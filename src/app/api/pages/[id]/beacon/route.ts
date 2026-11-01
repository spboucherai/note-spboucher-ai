import { handler, uuid } from "@/lib/api";
import { updatePage } from "@/lib/pages/service";
/** navigator.sendBeacon target for last-second autosave on page unload (same cookie auth; body is the PATCH payload). */
export const POST = handler(async ({ req, ws, params }) => {
  const id = uuid.parse(params.id); let patch: any = {}; try { patch = JSON.parse(await req.text()); } catch { return Response.json({ ok: false }, { status: 400 }); }
  const allowed: any = {}; for (const k of ["title", "content", "icon", "cover", "properties"]) if (patch[k] !== undefined) allowed[k] = patch[k];
  if (Object.keys(allowed).length) await updatePage(ws.id, id, allowed);
  return Response.json({ ok: true });
});
