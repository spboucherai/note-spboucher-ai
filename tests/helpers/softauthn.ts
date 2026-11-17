/**
 * TEST-ONLY software authenticator: builds WebAuthn registration/assertion responses with a P-256 key so the server-side verification
 * can be attacked deterministically (wrong origin, wrong RP ID, missing user verification, forged signature, replay, expiry).
 * The application itself never builds or parses WebAuthn structures by hand — it uses @simplewebauthn/server.
 */
import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";

const b64u = (b: Uint8Array | Buffer) => Buffer.from(b).toString("base64url");
const sha256 = (b: Uint8Array | Buffer | string) => createHash("sha256").update(b).digest();
export interface CeremonyOverrides { origin?: string; rpId?: string; uv?: boolean; up?: boolean; type?: string; challenge?: string; tamperSignature?: boolean; counter?: number }

export class SoftAuthenticator {
  readonly credentialId = randomBytes(32); private key: KeyObject; private pub: KeyObject; counter = 0;
  constructor() { const kp = generateKeyPairSync("ec", { namedCurve: "P-256" }); this.key = kp.privateKey; this.pub = kp.publicKey; }
  private cose() { const jwk = this.pub.export({ format: "jwk" }) as { x: string; y: string }; return isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x, "base64url"))], [-3, new Uint8Array(Buffer.from(jwk.y, "base64url"))]])); }
  private flags(o: CeremonyOverrides, attested: boolean) { return (o.up === false ? 0 : 0x01) | (o.uv === false ? 0 : 0x04) | (attested ? 0x40 : 0); }
  private clientData(type: string, challenge: string, origin: string) { return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false })); }

  register(options: { challenge: string; rp: { id?: string } }, origin: string, o: CeremonyOverrides = {}) {
    const rpId = o.rpId ?? options.rp.id!; const cnt = Buffer.alloc(4); cnt.writeUInt32BE(0);
    const len = Buffer.alloc(2); len.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([sha256(rpId), Buffer.from([this.flags(o, true)]), cnt, Buffer.alloc(16), len, this.credentialId, Buffer.from(this.cose())]);
    const attestationObject = isoCBOR.encode(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", new Uint8Array(authData)]]) as any);
    const clientDataJSON = this.clientData(o.type ?? "webauthn.create", o.challenge ?? options.challenge, o.origin ?? origin);
    return { id: b64u(this.credentialId), rawId: b64u(this.credentialId), type: "public-key" as const, response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ["internal"] }, clientExtensionResults: {}, authenticatorAttachment: "platform" };
  }
  assert(options: { challenge: string; rpId?: string }, origin: string, o: CeremonyOverrides = {}) {
    const rpId = o.rpId ?? options.rpId!; this.counter = o.counter ?? this.counter + 1; const cnt = Buffer.alloc(4); cnt.writeUInt32BE(this.counter);
    const authData = Buffer.concat([sha256(rpId), Buffer.from([this.flags(o, false)]), cnt]);
    const clientDataJSON = this.clientData(o.type ?? "webauthn.get", o.challenge ?? options.challenge, o.origin ?? origin);
    const signature = createSign("SHA256").update(Buffer.concat([authData, sha256(clientDataJSON)])).sign(this.key);
    if (o.tamperSignature) signature[signature.length - 1] ^= 0xff;
    return { id: b64u(this.credentialId), rawId: b64u(this.credentialId), type: "public-key" as const, response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature) }, clientExtensionResults: {}, authenticatorAttachment: "platform" };
  }
}
