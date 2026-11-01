import { hash, verify } from "@node-rs/argon2";
const ARGON2ID = 2; // @node-rs/argon2 Algorithm.Argon2id (const enum)
const OPTS = { algorithm: ARGON2ID, memoryCost: 65536, timeCost: 3, parallelism: 1, outputLen: 32 };
export const hashPassword = (pw: string) => hash(pw, OPTS);
export const verifyPassword = (h: string, pw: string) => verify(h, pw).catch(() => false);
export function passwordPolicy(pw: string): string | null {
  if (pw.length < 12) return "Password must be at least 12 characters.";
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw)) return "Use upper-case, lower-case letters and a digit.";
  return null;
}
