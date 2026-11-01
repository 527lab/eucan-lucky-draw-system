import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../db/client";
import { participants, spots, submissions, ticketAdjustments } from "../db/schema";
import { createTestDb } from "../db/test-helper";
import { getSettings, updateSetting } from "../settings";
import { loadEntitlements, ticketsFor } from "./entitlements-db";

const GHOST = "00000000-0000-0000-0000-000000000000";

describe("loadEntitlements（整合：PGlite）", () => {
  let handle: DbHandle;
  beforeEach(async () => {
    handle = await createTestDb();
  });
  afterEach(async () => {
    await handle.close();
  });

  async function fixture() {
    const { db } = handle;
    const [a, b, c] = await db
      .insert(participants)
      .values([
        { lineUserId: "Utest-e1", employeeNo: "A1001", status: "active" },
        { lineUserId: "Utest-e2", employeeNo: "A1002", status: "blocked" },
        { lineUserId: "Utest-e3", status: "pending_registration" },
      ])
      .returning();
    const [s1, s2] = await db
      .insert(spots)
      .values([{ name: "測試景點一" }, { name: "測試景點二" }])
      .returning();
    let n = 0;
    const mk = (p: string, s: string, status: "approved" | "rejected" | "pending_review") => ({
      participantId: p, spotId: s, lineMessageId: `m${++n}`, storageKey: `photos/x/${n}.jpg`, status,
    });
    await db.insert(submissions).values([
      mk(a.id, s1.id, "approved"),
      mk(a.id, s1.id, "approved"),
      mk(a.id, s2.id, "rejected"),
      mk(b.id, s1.id, "approved"),
    ]);
    return { a, b, c };
  }

  it("依 DB 資料計算並套用狀態與手動調整", async () => {
    const { a, b, c } = await fixture();
    const settings = await getSettings(handle.db);
    const all = await loadEntitlements(handle.db, settings);
    expect(all.get(a.id)!.tickets).toBe(1);
    expect(all.get(b.id)!.tickets).toBe(0);
    expect(all.get(c.id)!.tickets).toBe(0);
    await handle.db.insert(ticketAdjustments).values({ participantId: a.id, delta: 2, reason: "測試" });
    expect(await ticketsFor(handle.db, settings, a.id)).toBe(3);
  });

  it("改 ticket.mode 後結果跟著改變；找不到的參加者為 0", async () => {
    const { a } = await fixture();
    await updateSetting(handle.db, "ticket.mode", "threshold", "t");
    await updateSetting(handle.db, "ticket.minSpots", 2, "t");
    const settings = await getSettings(handle.db);
    expect(await ticketsFor(handle.db, settings, a.id)).toBe(0);
    expect(await ticketsFor(handle.db, settings, GHOST)).toBe(0);
    expect((await loadEntitlements(handle.db, settings, GHOST)).size).toBe(0);
  });

  it("沒有任何參加者 → 空 Map", async () => {
    expect((await loadEntitlements(handle.db, await getSettings(handle.db))).size).toBe(0);
  });
});
