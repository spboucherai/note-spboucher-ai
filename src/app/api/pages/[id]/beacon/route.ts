import { handler, uuid, HttpError } from "@/lib/api";
import { getPage, snapshot, unappliedVersion, updatePage } from "@/lib/pages/service";
import { assertDoc } from "@/lib/editor/validate";
import { docText, wordCount, type PMNode } from "@/lib/editor/text";
/**
 * Last-second save when a tab is hidden or closed (fetch keepalive / sendBeacon; same cookie + same-origin check; body = PATCH payload).
 * It can never overwrite silently: with a stale `baseVersion` the page is left untouched and the unsaved copy is kept in the version
 * history ("unsynced copy from a closed tab") where it can be compared and restored.
 */
export const POST = handler(async ({ req, ws, params }) => {
  const id = uuid.parse(params.id); let patch: any = {}; try { patch = JSON.parse(await req.text()); } catch { return Response.json({ ok: false }, { status: 400 }); }
  const allowed: any = {}; for (const k of ["title", "content", "icon", "cover", "properties"]) if (patch[k] !== undefined) allowed[k] = patch[k];
  if (allowed.content !== undefined) assertDoc(allowed.content);
  if (allowed.title !== undefined && (typeof allowed.title !== "string" || allowed.title.length > 500)) throw new HttpError(400, "Invalid title");
  if (!Object.keys(allowed).length) return Response.json({ ok: true });
  const baseVersion = Number.isInteger(patch.baseVersion) ? (patch.baseVersion as number) : undefined;
  try { const p = await updatePage(ws.id, id, allowed, { baseVersion }); return Response.json({ ok: true, version: p.version }); }
  catch (e) {
    if (!(e instanceof HttpError) || e.code !== "conflict") throw e;
    const cur = await getPage(ws.id, id); const content = (allowed.content ?? cur.content) as PMNode;
    await snapshot({ id, version: unappliedVersion(), title: (allowed.title as string | undefined)?.trim() || cur.title, content, properties: cur.properties, wordCount: wordCount(docText(content)) }, "unsynced copy from a closed tab (not applied)");
    return Response.json({ ok: false, code: "conflict", preserved: true }, { status: 409 });
  }
});
