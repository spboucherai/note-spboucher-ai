/**
 * DEVELOPMENT ONLY (scratch database, loopback) — seeds the small workspace used by the live AI verification
 * (`scripts/next-ai-live.ts`, results in docs/next/AI-LIVE-VERIFICATION.md): one project with six notes holding distinct facts — two of
 * them contradict each other on purpose (the prepayment penalty: three months in the bank's offer, six months in the broker's minutes) —
 * one note outside the project, and one capture waiting in the inbox. Everything goes through the HTTP API of the running scratch
 * server, so the live worker indexes it like any other note.
 *   set -a && . ./.env && set +a
 *   node_modules/.bin/tsx scripts/next-ai-seed.ts            # seed; ids written to $DATA_DIR/ai-live-seed.json
 *   node_modules/.bin/tsx scripts/next-ai-seed.ts --clean    # delete exactly what the seed and the live run created (by id)
 */
import "../tests/helpers/testdb";
import fs from "node:fs";
import path from "node:path";
import { sql } from "../src/db/index";
import { createSession, ownerRow } from "../src/lib/auth/sessions";

export const SEED_FILE = path.join(process.env.DATA_DIR ?? "/tmp", "ai-live-seed.json");
const BASE = (process.env.APP_URL ?? "").replace(/\/$/, ""); if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("loopback only");
const para = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const h2 = (t: string) => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: t }] });
const doc = (...c: unknown[]) => ({ type: "doc", content: c });

if (process.argv.includes("--clean")) {
  if (!fs.existsSync(SEED_FILE)) { console.log("nothing to clean"); await sql.end(); process.exit(0); }
  const s = JSON.parse(fs.readFileSync(SEED_FILE, "utf8")); const x = s.extra ?? {}; const pages: string[] = [...Object.values(s.pages as Record<string, string>), ...(x.pages ?? [])];
  const n: Record<string, number> = {};
  const del = async (k: string, q: PromiseLike<unknown>) => { n[k] = ((await q) as { count: number }).count; };
  if (x.insights?.length) await del("insights", sql`delete from knowledge_insights where id = any(${x.insights}::uuid[])`);
  if (x.concepts?.length) await del("concepts", sql`delete from concepts where id = any(${x.concepts}::uuid[])`);
  if (x.executions?.length) await del("executions", sql`delete from ai_executions where id = any(${x.executions}::uuid[])`);
  if (x.conversations?.length) await del("conversations", sql`delete from ai_conversations where id = any(${x.conversations}::uuid[])`);
  if (x.attachments?.length) await del("attachments", sql`delete from attachments where id = any(${x.attachments}::uuid[])`);
  if (x.tags?.length) await del("tags", sql`delete from tags t where t.name = any(${x.tags}::text[]) and not exists (select 1 from page_tags pt where pt.tag_id = t.id and pt.page_id <> all(${pages}::uuid[]))`);
  await del("tasks", sql`delete from tasks where page_id = any(${pages}::uuid[])`);
  await del("edges", sql`delete from knowledge_edges where from_id = any(${pages}::uuid[]) or to_id = any(${pages}::uuid[])`);
  await del("chunks", sql`delete from chunks where page_id = any(${pages}::uuid[])`);
  await del("events", sql`delete from knowledge_events where page_id = any(${pages}::uuid[])`);
  await del("rowPages", sql`delete from pages where parent_id = any(${pages}::uuid[]) or database_id in (select id from databases where page_id = any(${pages}::uuid[]))`);
  await del("pages", sql`delete from pages where id = any(${pages}::uuid[])`);
  fs.renameSync(SEED_FILE, SEED_FILE.replace(/\.json$/, `.cleaned-${s.tag}.json`)); console.log("cleaned", JSON.stringify(n)); await sql.end(); process.exit(0);
}

const u = await ownerRow(); if (!u) throw new Error("no owner"); const sess = await createSession({ userId: u.id, credentialId: null, userAgent: "SPNotes/ai-live-seed native", ip: "127.0.0.1" });
const cookie = `__Host-note_session=${sess.token}`;
const post = async (p: string, body: unknown, method = "POST") => { const r = await fetch(BASE + p, { method, headers: { cookie, origin: BASE, "content-type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => null); if (r.status >= 300) throw new Error(`${method} ${p} → ${r.status} ${JSON.stringify(j)}`); return j; };
const TAG = Date.now().toString(36); const P = `AILIVE-${TAG} ·`; const pages: Record<string, string> = {};
const mk = async (key: string, title: string, content: unknown, extra: Record<string, unknown> = {}) => { pages[key] = (await post("/api/pages", { title: `${P} ${title}`, content, ...extra })).id; return pages[key]; };

const project = await mk("project", "Refinancement du triplex de la rue Cartier", doc(para("Dossier du refinancement hypothécaire du triplex de la rue Cartier à Gatineau : offres des prêteurs, évaluation, baux, travaux à prévoir et comptes rendus des rencontres.")), { section: "projects" });
const child = { parentId: project, section: "projects" };
await mk("bnc", "Offre de la Banque Nationale", doc(h2("Conditions"), para("Le taux fixe cinq ans proposé par la Banque Nationale est de 4,29 %, garanti 90 jours, soit jusqu'au 15 février 2027."), para("La pénalité de remboursement anticipé de la Banque Nationale équivaut à trois mois d'intérêts."), para("L'amortissement restant est de vingt-deux ans.")), child);
await mk("desjardins", "Offre de Desjardins", doc(h2("Conditions"), para("Desjardins propose un taux fixe cinq ans de 4,44 % avec une remise en argent de 2 500 $ à la signature."), para("Chez Desjardins, la pénalité de remboursement anticipé est calculée selon le différentiel de taux d'intérêt.")), child);
await mk("evaluation", "Évaluation du triplex", doc(para("L'évaluateur agréé Martin Roy établit la valeur marchande du triplex à 815 000 $ dans son rapport du 3 novembre 2026."), para("La méthode du revenu repose sur des revenus bruts de 61 200 $ par année et un taux global d'actualisation de 5,1 %.")), child);
await mk("courtier", "Compte rendu — rencontre avec le courtier, 12 novembre 2026", doc(h2("Points discutés"), para("Le courtier confirme que la pénalité de remboursement anticipé de la Banque Nationale est de six mois d'intérêts."), h2("Décisions"), para("Nous retenons le taux fixe cinq ans plutôt que le taux variable."), para("Julie Tremblay envoie les documents signés à la banque avant le 28 novembre 2026.")), child);
await mk("toiture", "Travaux de toiture", doc(para("La soumission de Toitures Laurier pour refaire la toiture du triplex est de 18 400 $, taxes incluses."), para("Les travaux sont prévus en mai 2027 et sont couverts par une garantie de dix ans.")), child);
await mk("baux", "Baux et loyers", doc(para("Logement 1 : 1 450 $ par mois, bail jusqu'au 30 juin 2027."), para("Logement 2 : 1 725 $ par mois, bail jusqu'au 30 juin 2027."), para("Logement 3 : 1 925 $ par mois, bail jusqu'au 30 septembre 2027."), para("Total des loyers : 5 100 $ par mois, soit 61 200 $ par année.")), child);
await mk("garch", "Lecture — GARCH et persistance de la volatilité", doc(para("Bollerslev (1986) généralise le modèle ARCH d'Engle : la variance conditionnelle dépend de ses propres retards."), para("Dans un GARCH(1,1), la persistance de la volatilité est mesurée par la somme alpha + bêta ; le processus est stationnaire si elle est inférieure à 1."), para("Sur les rendements quotidiens des FPI canadiennes, la somme estimée dans mes essais est de 0,97.")), { section: "research" });
for (const k of ["bnc", "desjardins"]) await post(`/api/pages/${pages[k]}/tags`, { tags: [`ailive-${TAG}-refinancement`, `ailive-${TAG}-triplex`] }, "PUT");
pages.capture = (await post("/api/capture", { kind: "note", text: `${P} appeler le notaire pour le triplex\nMe Gagnon demande l'acte de prêt actuel avant le 4 décembre 2026 pour préparer la quittance du refinancement du triplex de la rue Cartier.` })).id;
fs.writeFileSync(SEED_FILE, JSON.stringify({ tag: TAG, prefix: P, seededAt: new Date().toISOString(), pages, extra: { tags: [`ailive-${TAG}-refinancement`, `ailive-${TAG}-triplex`] } }, null, 1));
// wait until the live worker has indexed every page (chunks + embeddings): Ask and the suggestions retrieve from the index
const ids = Object.values(pages); const t0 = Date.now();
for (;;) { const [{ n }] = await sql`select count(distinct c.page_id)::int as n from chunks c join embeddings e on e.chunk_id = c.id where c.page_id = any(${ids}::uuid[])`; if (n >= ids.length - 1 /* the project root may be one short chunk; the capture is indexed too */ && Date.now() - t0 > 3000) { console.log(`indexed pages: ${n}/${ids.length}`); break; } if (Date.now() - t0 > 90_000) { console.log(`TIMEOUT: only ${n}/${ids.length} pages indexed — is the worker running?`); break; } await new Promise((r) => setTimeout(r, 1500)); }
console.log("seeded", SEED_FILE, JSON.stringify(pages)); await sql.end();
