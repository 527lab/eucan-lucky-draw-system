import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../db/client";
import { createTestDb } from "../db/test-helper";
import { adminAuditLogs, drawRuns } from "../db/schema";
import {
  getDefaults,
  getSettings,
  SETTING_KEYS,
  SettingsLockedError,
  SettingsValidationError,
  updateSetting,
} from ".";

let h: DbHandle;
beforeEach(async () => {
  h = await createTestDb();
});
afterEach(async () => {
  await h.close();
});

const actor = "E999 測試主管";

describe("getSettings", () => {
  it("DB 沒有資料時回傳完整預設值", async () => {
    const s = await getSettings(h.db);
    expect(s).toEqual(getDefaults());
    expect(Object.keys(s).sort()).toEqual([...SETTING_KEYS].sort());
    expect(s["ticket.mode"]).toBe("per_spot");
    expect(s["event.name"]).toBe("EUCAN 2027 員工旅遊");
    expect(s["upload.deadlineAt"]).toBeNull();
  });

  it("DB 值覆蓋預設值，其他維持預設", async () => {
    await updateSetting(h.db, "upload.maxPerSpotPerUser", 8, actor);
    const s = await getSettings(h.db);
    expect(s["upload.maxPerSpotPerUser"]).toBe(8);
    expect(s["review.mode"]).toBe("auto");
  });
});

describe("updateSetting 驗證", () => {
  it("拒絕不合法的值與未知鍵", async () => {
    await expect(updateSetting(h.db, "ticket.mode", "foo", actor)).rejects.toThrow(
      SettingsValidationError,
    );
    await expect(
      updateSetting(h.db, "upload.pendingSpotTtlMinutes", -1, actor),
    ).rejects.toThrow(SettingsValidationError);
    await expect(updateSetting(h.db, "nope.key", 1, actor)).rejects.toThrow(
      SettingsValidationError,
    );
    expect((await getSettings(h.db))["ticket.mode"]).toBe("per_spot");
  });

  it("寫入後留下稽核紀錄", async () => {
    await updateSetting(h.db, "event.name", "新名稱", actor);
    const logs = await h.db
      .select()
      .from(adminAuditLogs)
      .where(eq(adminAuditLogs.targetId, "event.name"));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actor, action: "settings.update" });
    expect(logs[0].payload).toEqual({ before: null, after: "新名稱" });
  });

  it("接受 datetime 與 null", async () => {
    await updateSetting(h.db, "upload.deadlineAt", "2027-05-01T12:00:00+08:00", actor);
    expect((await getSettings(h.db))["upload.deadlineAt"]).toBe("2027-05-01T12:00:00+08:00");
    await updateSetting(h.db, "upload.deadlineAt", null, actor);
    await expect(updateSetting(h.db, "upload.deadlineAt", "明天", actor)).rejects.toThrow(
      SettingsValidationError,
    );
  });
});

describe("抽獎鎖定（spec §7.3）", () => {
  it("存在 locked draw_run 時不可改 ticket.* 與 review.mode，取消後可改", async () => {
    const [run] = await h.db.insert(drawRuns).values({ status: "locked" }).returning();

    await expect(updateSetting(h.db, "ticket.mode", "complete_all", actor)).rejects.toThrow(
      SettingsLockedError,
    );
    await expect(updateSetting(h.db, "ticket.maxPerUser", 3, actor)).rejects.toThrow(
      SettingsLockedError,
    );
    await expect(updateSetting(h.db, "review.mode", "manual", actor)).rejects.toThrow(
      SettingsLockedError,
    );
    expect((await getSettings(h.db))["ticket.mode"]).toBe("per_spot");
    // 其他設定不受影響
    await updateSetting(h.db, "event.name", "鎖定中仍可改", actor);

    await h.db.update(drawRuns).set({ status: "cancelled" }).where(eq(drawRuns.id, run.id));
    await updateSetting(h.db, "ticket.mode", "complete_all", actor);
    expect((await getSettings(h.db))["ticket.mode"]).toBe("complete_all");
  });

  it("被拒絕的修改不會留下稽核紀錄", async () => {
    await h.db.insert(drawRuns).values({ status: "locked" });
    await expect(updateSetting(h.db, "ticket.mode", "threshold", actor)).rejects.toThrow();
    expect(await h.db.select().from(adminAuditLogs)).toHaveLength(0);
  });
});
