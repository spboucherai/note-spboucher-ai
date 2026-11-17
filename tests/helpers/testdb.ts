/** Tests only ever run against a scratch database: refuse anything that does not look like one. */
import "dotenv/config";
export function assertTestDatabase() {
  const url = process.env.DATABASE_URL ?? ""; const name = url.split("/").pop()?.split("?")[0] ?? "";
  if (!/(_dev|_test|_scratch)$/.test(name)) throw new Error(`Refusing to run tests against database "${name}" (expected a name ending in _dev, _test or _scratch).`);
}
assertTestDatabase();
