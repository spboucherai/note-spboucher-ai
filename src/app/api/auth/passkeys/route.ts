import { handler } from "@/lib/api";
import { listPasskeys } from "@/lib/auth/webauthn";
/** GET → registered passkeys (label, dates, sync state). Public keys are never returned. */
export const GET = handler(async ({ user }) => {
  const rows = await listPasskeys(user.id);
  return Response.json(rows.map((r) => ({ id: r.id, label: r.label ?? "Passkey", createdAt: r.createdAt, lastUsedAt: r.lastUsedAt, synced: Boolean(r.backedUp), multiDevice: r.deviceType === "multiDevice", transports: r.transports ?? [], current: r.id === user.credentialId })));
});
