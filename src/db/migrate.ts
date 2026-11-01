import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
const url = process.env.DATABASE_URL; if (!url) throw new Error("DATABASE_URL missing");
const sql = postgres(url, { max: 1 });
for (const ext of ["vector", "pg_trgm", "unaccent"]) { try { await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS ${ext}`); } catch (e: any) { const ok = (await sql`select 1 from pg_extension where extname = ${ext}`).length > 0; if (!ok) throw new Error(`extension ${ext} missing and cannot be created by this role: ${e.message}`); } }
await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
console.log("migrations applied"); await sql.end();
