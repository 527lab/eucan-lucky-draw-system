/** 用法：tsx scripts/db.ts migrate | seed（需要 DATABASE_URL；請用 --env-file 或 shell 提供）。 */
import { createDb, runMigrations } from "../src/lib/db/client";
import { seed } from "../src/lib/db/seed";

async function main() {
  const cmd = process.argv[2];
  if (cmd !== "migrate" && cmd !== "seed") {
    throw new Error("用法：tsx scripts/db.ts migrate | seed");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 未設定");
  const handle = await createDb();
  try {
    if (cmd === "migrate") {
      await runMigrations(handle);
      console.log("migration 完成");
    } else {
      console.log("seed 完成", await seed(handle.db));
    }
  } finally {
    await handle.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
