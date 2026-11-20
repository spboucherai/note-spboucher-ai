/**
 * Runs once when the web process starts. Guarantee: a deployment or restart never comes up with an enrollment window open —
 * any window left open is closed here (a new one must be opened deliberately from the node shell). Configuration problems and
 * leftover legacy variables are logged by name, never by value.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  await import("@/lib/net-defaults"); // before any outbound connection (AI providers, embeddings, Crossref)
  const { closeEnrollments } = await import("@/lib/auth/enrollment");
  const { configProblems, legacyEnvPresent } = await import("@/lib/auth/config");
  const { log } = await import("@/lib/log");
  try { const n = await closeEnrollments("server-start"); if (n) log.warn({ closed: n }, "enrollment window(s) closed at startup"); } catch (e) { log.error({ detail: String((e as Error).message).slice(0, 200) }, "could not close enrollment windows at startup"); }
  const problems = configProblems(); if (problems.length) log.error({ problems }, "passkey configuration problems");
  const legacy = legacyEnvPresent(); if (legacy.length) log.warn({ variables: legacy }, "legacy access variables are still set; they are ignored — remove them from .env");
}
