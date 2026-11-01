import { eq, ne } from "drizzle-orm";
import type { Db } from "../db/client";
import { adminAuditLogs, drawRuns, settings as settingsTable } from "../db/schema";
import {
  getDefaults,
  isLockableKey,
  isSettingKey,
  settingsSchemas,
  type SettingKey,
  type Settings,
} from "./schema";

export * from "./schema";

export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsValidationError";
  }
}

export class SettingsLockedError extends Error {
  constructor(readonly key: string) {
    super(`抽獎已鎖定，無法修改 ${key}；請先取消本次抽獎`);
    this.name = "SettingsLockedError";
  }
}

/** 是否存在尚未取消的 draw_run（locked／drawn／announced 皆視為鎖定）。 */
export async function isDrawLocked(db: Db): Promise<boolean> {
  const rows = await db
    .select({ id: drawRuns.id })
    .from(drawRuns)
    .where(ne(drawRuns.status, "cancelled"))
    .limit(1);
  return rows.length > 0;
}

/** 預設值 + DB 值。DB 中無效的值會退回預設值。 */
export async function getSettings(db: Db): Promise<Settings> {
  const result: Record<string, unknown> = { ...getDefaults() };
  const rows = await db.select().from(settingsTable);
  for (const row of rows) {
    if (!isSettingKey(row.key)) continue;
    const parsed = settingsSchemas[row.key].safeParse(row.value);
    if (parsed.success) result[row.key] = parsed.data;
  }
  return result as Settings;
}

/** 驗證後寫入設定並留稽核紀錄；抽獎鎖定時 ticket.*、review.mode 會拋錯。 */
export async function updateSetting(
  db: Db,
  key: string,
  value: unknown,
  actor: string,
): Promise<Settings[SettingKey]> {
  if (!isSettingKey(key)) {
    throw new SettingsValidationError(`未知的設定鍵：${key}`);
  }
  const parsed = settingsSchemas[key].safeParse(value);
  if (!parsed.success) {
    throw new SettingsValidationError(
      `設定 ${key} 的值無效：${parsed.error.issues.map((i) => i.message).join("；")}`,
    );
  }

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as Db;
    if (isLockableKey(key) && (await isDrawLocked(txDb))) {
      throw new SettingsLockedError(key);
    }
    const [before] = await tx
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, key));
    await tx
      .insert(settingsTable)
      .values({ key, value: parsed.data, updatedBy: actor })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: { value: parsed.data, updatedBy: actor, updatedAt: new Date() },
      });
    await tx.insert(adminAuditLogs).values({
      actor,
      action: "settings.update",
      targetType: "setting",
      targetId: key,
      payload: { before: before?.value ?? null, after: parsed.data },
    });
  });
  return parsed.data;
}
