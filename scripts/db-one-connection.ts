/**
 * File: scripts/db-one-connection.ts
 * Description: import FIRST in a maintenance script — the shared pool of `src/db` is then a single connection (the node's PostgreSQL is
 *   shared with other databases; a seed or a benchmark must not take ten slots).
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import "dotenv/config";
import postgres from "postgres";
(globalThis as unknown as { __sql?: unknown }).__sql = postgres(process.env.DATABASE_URL!, { max: 1, idle_timeout: 30, prepare: false, transform: { undefined: null } });
