/**
 * Manage the access gate secrets in ./.env (never prints them).
 *   pnpm access:password        → prompt (hidden) or read stdin, store ACCESS_PASSWORD_HASH=b64:<argon2id PHC, base64url>
 *   pnpm access:rotate-key      → new 32-byte base64url ACCESS_KEY (old bookmark links stop working)
 * Changing either value invalidates every device cookie. Restart note-web afterwards: pm2 restart note-web
 */
import { readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { stdin, stdout } from "node:process";
import { hashPassword } from "../lib/auth/password";

const ENV = ".env";
function setVar(name: string, value: string) {
  const src = existsSync(ENV) ? readFileSync(ENV, "utf8") : "";
  const line = `${name}=${value}`; const re = new RegExp(`^${name}=.*$`, "m");
  const out = re.test(src) ? src.replace(re, line) : src.replace(/\n?$/, "\n") + line + "\n";
  writeFileSync(ENV, out); chmodSync(ENV, 0o600);
}
async function readSecret(q: string): Promise<string> {
  if (!stdin.isTTY) { let b = ""; stdin.setEncoding("utf8"); for await (const c of stdin) b += c; return b.split("\n")[0].trim(); }
  return new Promise((resolve) => { stdout.write(q); let buf = ""; const on = (ch: Buffer) => { const c = ch.toString("utf8"); if (c === "\n" || c === "\r") { stdin.setRawMode(false); stdin.pause(); stdin.off("data", on); stdout.write("\n"); resolve(buf); } else if (c === "\u0003") process.exit(1); else if (c === "\u007f") buf = buf.slice(0, -1); else buf += c; }; stdin.setRawMode(true); stdin.resume(); stdin.on("data", on); });
}
const cmd = process.argv[2];
if (cmd === "rotate-key") { setVar("ACCESS_KEY", randomBytes(32).toString("base64url")); console.log("ACCESS_KEY rotated in .env (value not shown). Restart note-web and update the bookmark."); }
else if (cmd === "password") {
  const pw = await readSecret("New access password: "); if (pw.length < 4) { console.error("Too short."); process.exit(1); }
  const phc = await hashPassword(pw);
  setVar("ACCESS_PASSWORD_HASH", "b64:" + Buffer.from(phc, "utf8").toString("base64url"));
  if (!/^ACCESS_KEY=.{32,}$/m.test(readFileSync(ENV, "utf8"))) setVar("ACCESS_KEY", randomBytes(32).toString("base64url"));
  console.log("ACCESS_PASSWORD_HASH stored in .env (argon2id). Restart note-web.");
} else { console.error("usage: tsx src/cli/access.ts password|rotate-key"); process.exit(2); }
