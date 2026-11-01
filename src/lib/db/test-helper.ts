import { createPgliteDb, runMigrations, type DbHandle } from "./client";

/** 測試用：每次呼叫都建立全新的記憶體內 PGlite 並套用 migration。用完請 close()。 */
export async function createTestDb(): Promise<DbHandle> {
  const handle = await createPgliteDb();
  await runMigrations(handle);
  return handle;
}
