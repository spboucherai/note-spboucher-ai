import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { __sql?: ReturnType<typeof postgres> };
export const sql = globalForDb.__sql ?? postgres(process.env.DATABASE_URL!, { max: Math.max(1, Number(process.env.DB_POOL_MAX ?? 10) || 10) /* DB_POOL_MAX: smaller pools on shared scratch servers; default unchanged */, idle_timeout: 30, prepare: false, transform: { undefined: null } });
if (process.env.NODE_ENV !== "production") globalForDb.__sql = sql;
export const db = drizzle(sql, { schema, casing: "snake_case" });
export { schema };
export type DB = typeof db;
