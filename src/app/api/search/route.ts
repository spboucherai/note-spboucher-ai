import { handler } from "@/lib/api";
import { hybridSearch, quickSearch } from "@/lib/search";
export const GET = handler(async ({ req, ws }) => {
  const u = new URL(req.url); const q = u.searchParams.get("q") ?? ""; const mode = u.searchParams.get("mode") ?? "quick";
  if (mode === "quick") return Response.json(await quickSearch(ws.id, q, Number(u.searchParams.get("limit") ?? 10)));
  const hits = await hybridSearch(ws.id, q, { limit: Number(u.searchParams.get("limit") ?? 20), sourceTypes: u.searchParams.get("types")?.split(",").filter(Boolean), semantic: u.searchParams.get("semantic") !== "0" });
  return Response.json(hits);
});
