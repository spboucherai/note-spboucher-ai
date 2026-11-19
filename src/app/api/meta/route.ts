import { handler } from "@/lib/api";
import { API_LEVEL, FEATURES, serverVersion } from "@/lib/meta";
export const dynamic = "force-dynamic";
/** GET /api/meta → `{api, version, features, serverTime}` (SPEC §1). Clients gate the 3.0 UI on `features`, never on the version string. */
export const GET = handler(async () => Response.json({ api: API_LEVEL, version: serverVersion(), features: [...FEATURES], serverTime: new Date().toISOString() }));
