import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export { schema };

/** pg 與 PGlite 共用的 Drizzle 型別，業務程式只依賴這個。 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export const MIGRATIONS_FOLDER = path.resolve(process.cwd(), "drizzle");

export type DbHandle = {
  db: Db;
  driver: "pg" | "pglite";
  /** 關閉連線。 */
  close: () => Promise<void>;
};

/**
 * 依環境選擇 driver：
 * - 有 DATABASE_URL → `pg`（正式環境連 compose 內的 Postgres）。
 * - 沒有 DATABASE_URL 且 APP_ENV=test → 記憶體內 PGlite。
 * - 其他情況拋出錯誤。
 * 動態 import，避免未使用的 driver 被載入。
 */
export async function createDb(
  env: Record<string, string | undefined> = process.env,
): Promise<DbHandle> {
  const url = env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({ connectionString: url });
    return {
      db: drizzle(pool, { schema }) as unknown as Db,
      driver: "pg",
      close: () => pool.end(),
    };
  }
  if (env.APP_ENV === "test") return createPgliteDb();
  throw new Error("DATABASE_URL 未設定（僅 APP_ENV=test 可使用 PGlite）");
}

/** 全新的記憶體內 PGlite（尚未執行 migration）。 */
export async function createPgliteDb(dataDir?: string): Promise<DbHandle> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite(dataDir);
  return {
    db: drizzle(client, { schema }) as unknown as Db,
    driver: "pglite",
    close: () => client.close(),
  };
}

/** 對指定連線執行 migration。 */
export async function runMigrations(handle: DbHandle): Promise<void> {
  if (handle.driver === "pglite") {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(handle.db as never, { migrationsFolder: MIGRATIONS_FOLDER });
  } else {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(handle.db as never, { migrationsFolder: MIGRATIONS_FOLDER });
  }
}

let shared: Promise<DbHandle> | undefined;

/** 應用程式共用連線（快取）。記憶體內 PGlite（僅 test）會自動執行 migration。 */
export function getDb(): Promise<Db> {
  shared ??= createDb().then(async (h) => {
    if (h.driver === "pglite") {
      await runMigrations(h);
      if (process.env.APP_ENV === "test" && process.env.ADMIN_FIXTURES === "1") {
        const { seedFixtures } = await import("./fixtures");
        await seedFixtures(h.db);
      }
    }
    return h;
  });
  return shared.then((h) => h.db);
}
