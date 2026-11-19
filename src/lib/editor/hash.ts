/**
 * file: src/lib/editor/hash.ts
 * description: SHA-256 (lower-case hex) of a UTF-8 string through WebCrypto — the `previewHash` of a `mermaid` node is the hash of the
 *   `code` its render was made from (SPEC §2). Works in browsers (secure context) and in Node ≥ 20.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
export async function sha256Hex(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
