import type { Db } from "../db/client";
import { adminAuditLogs } from "../db/schema";

/** 寫入後台稽核紀錄。payload 不得包含密碼或任何憑證。 */
export async function writeAdminAudit(
  db: Db,
  entry: { actor: string; action: string; targetType?: string; targetId?: string; payload?: unknown },
): Promise<void> {
  await db.insert(adminAuditLogs).values({
    actor: entry.actor,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    payload: entry.payload ?? null,
  });
}

/** 登入成功後的稽核（備援登入一定要寫；一般登入也寫，方便追溯）。 */
export async function auditLogin(
  db: Db,
  result: { actor: string; breakGlass: boolean },
): Promise<void> {
  await writeAdminAudit(db, {
    actor: result.actor,
    action: result.breakGlass ? "auth.login.break-glass" : "auth.login",
  });
}
