/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/worker/handlers/maintenance.ts
 * Module           : worker
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
 * Last Modified    : 2026-11-17
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: contact@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

/** Hourly housekeeping. Deletes only expired technical rows (never content) and flags work that silently stopped. */
import { and, eq, lt, isNotNull, or, sql as dsql } from "drizzle-orm";
import { db, schema } from "../../db/index";
export async function handleMaintenance() {
  const idem = (await db.delete(schema.idempotencyKeys).where(lt(schema.idempotencyKeys.createdAt, new Date(Date.now() - 48 * 3600_000))).returning({ k: schema.idempotencyKeys.key })).length;
  const chal = (await db.delete(schema.webauthnChallenges).where(lt(schema.webauthnChallenges.expiresAt, new Date())).returning({ id: schema.webauthnChallenges.id })).length;
  const attempts = (await db.delete(schema.loginAttempts).where(lt(schema.loginAttempts.createdAt, new Date(Date.now() - 30 * 86_400_000))).returning({ id: schema.loginAttempts.id })).length;
  // enrollment windows: expired ones are marked closed (kept 90 days for the audit trail, then removed)
  await db.update(schema.authEnrollments).set({ closedReason: "expired" }).where(and(lt(schema.authEnrollments.expiresAt, new Date()), dsql`${schema.authEnrollments.consumedAt} is null and ${schema.authEnrollments.closedReason} is null`));
  await db.delete(schema.authEnrollments).where(lt(schema.authEnrollments.createdAt, new Date(Date.now() - 90 * 86_400_000)));
  // sessions dead for more than 90 days carry no information any more
  const sessions = (await db.delete(schema.sessions).where(or(and(isNotNull(schema.sessions.revokedAt), lt(schema.sessions.revokedAt, new Date(Date.now() - 90 * 86_400_000))), lt(schema.sessions.absoluteExpiresAt, new Date(Date.now() - 90 * 86_400_000)))).returning({ id: schema.sessions.id })).length;
  // a backup still "running" after 6 h did not finish (worker killed, node rebooted): say so instead of leaving it pending forever
  const stalled = (await db.update(schema.backupJobs).set({ status: "failed", error: "stalled: no completion after 6 h (worker restarted?)", finishedAt: new Date() }).where(and(eq(schema.backupJobs.status, "running"), lt(schema.backupJobs.startedAt, new Date(Date.now() - 6 * 3600_000)))).returning({ id: schema.backupJobs.id })).length;
  const actions = (await db.delete(schema.inboxActions).where(lt(schema.inboxActions.createdAt, new Date(Date.now() - 90 * 86_400_000))).returning({ id: schema.inboxActions.id })).length;
  // index rows of pages/files that no longer exist (purged): technical leftovers, never content the owner still has
  const orphans = (await db.execute(dsql`delete from chunks c where (c.source_type = 'page' and not exists (select 1 from pages p where p.id = c.source_id)) or (c.source_type = 'attachment' and not exists (select 1 from attachments a where a.id = c.source_id)) returning c.id`) as unknown as unknown[]).length;
  await db.execute(dsql`delete from index_state s where (s.source_type = 'page' and not exists (select 1 from pages p where p.id = s.source_id)) or (s.source_type = 'attachment' and not exists (select 1 from attachments a where a.id = s.source_id))`);
  return { orphanChunks: orphans, idempotencyKeys: idem, challenges: chal, loginAttempts: attempts, sessions, stalledBackups: stalled, inboxActions: actions };
}
