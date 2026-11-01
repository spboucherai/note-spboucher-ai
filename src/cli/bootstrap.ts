/**
 * Secure owner bootstrap: prompts for username + password interactively (never echoed, never logged),
 * stores only the Argon2id hash, creates the workspace and the default home layout.
 * Usage (on the node): pnpm bootstrap
 */
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "../db/index";
import { hashPassword, passwordPolicy } from "../lib/auth/password";

// Non-interactive mode (stdin is a pipe): answers are read line by line in order: username, display name, email, password, confirm.
const piped: string[] = stdin.isTTY ? [] : (await new Promise<string>((res) => { let b = ""; stdin.setEncoding("utf8"); stdin.on("data", (c) => (b += c)); stdin.on("end", () => res(b)); })).split("\n");
const ask = async (q: string, hidden = false): Promise<string> => {
  if (!stdin.isTTY) { stdout.write(q + (hidden ? "[hidden]" : (piped[0] ?? "")) + "\n"); return (piped.shift() ?? "").trim(); }
  if (!hidden) { const rl = readline.createInterface({ input: stdin, output: stdout }); const v = await rl.question(q); rl.close(); return v.trim(); }
  return new Promise((resolve) => {
    stdout.write(q); let buf = "";
    const onData = (ch: Buffer) => { const c = ch.toString("utf8"); if (c === "\n" || c === "\r" || c === "\u0004") { stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData); stdout.write("\n"); resolve(buf); } else if (c === "\u0003") process.exit(1); else if (c === "\u007f") buf = buf.slice(0, -1); else buf += c; };
    stdin.setRawMode(true); stdin.resume(); stdin.on("data", onData);
  });
};
const username = (await ask("Owner username [simon]: ")) || "simon";
const displayName = (await ask("Display name [Simon-Pierre Boucher]: ")) || "Simon-Pierre Boucher";
const email = (await ask("Email (optional): ")) || null;
let password = "";
for (;;) {
  password = await ask("Password (min 12 chars, upper/lower/digit): ", true);
  const err = passwordPolicy(password); if (err) { console.log(err); if (!stdin.isTTY) process.exit(1); continue; }
  const again = await ask("Confirm password: ", true);
  if (again !== password) { console.log("Passwords differ."); if (!stdin.isTTY) process.exit(1); continue; }
  break;
}
const passwordHash = await hashPassword(password);
password = "";
const [existing] = await db.select().from(schema.users).where(eq(schema.users.username, username)).limit(1);
let userId: string;
if (existing) { await db.update(schema.users).set({ passwordHash, displayName, email, updatedAt: new Date() }).where(eq(schema.users.id, existing.id)); userId = existing.id; console.log(`Password updated for '${username}'.`); }
else { const [u] = await db.insert(schema.users).values({ username, displayName, email, passwordHash }).returning(); userId = u.id; console.log(`User '${username}' created.`); }
const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.ownerId, userId)).limit(1);
if (!ws) { await db.insert(schema.workspaces).values({ ownerId: userId, name: "Note SPBoucher AI", slug: "main" }); console.log("Workspace created."); }
const [layout] = await db.select().from(schema.dashboardLayouts).where(eq(schema.dashboardLayouts.userId, userId)).limit(1);
if (!layout) await db.insert(schema.dashboardLayouts).values({ userId, name: "Home", widgets: [
  { id: "quick", type: "quick_capture", size: "wide" }, { id: "recent", type: "recent_pages", size: "half" }, { id: "pinned", type: "pinned", size: "half" },
  { id: "tasks", type: "tasks_due", size: "half" }, { id: "projects", type: "active_projects", size: "half" }, { id: "research", type: "research_activity", size: "half" },
  { id: "graph", type: "graph_highlights", size: "half" }, { id: "summary", type: "ai_summary", size: "wide" }, { id: "chat", type: "ai_chat", size: "wide" }] });
await db.insert(schema.aiProviders).values([{ id: "openai", name: "OpenAI" }, { id: "anthropic", name: "Anthropic" }]).onConflictDoNothing();
console.log("Bootstrap complete. Only the password hash was stored.");
await sql.end();
