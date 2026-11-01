import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "./client";
import { createTestDb } from "./test-helper";
import { seed } from "./seed";
import {
  drawRuns,
  participants,
  prizes,
  spots,
  submissions,
  webhookEvents,
} from "./schema";

let h: DbHandle;
beforeEach(async () => {
  h = await createTestDb();
});
afterEach(async () => {
  await h.close();
});

async function newParticipant(lineUserId = "U1") {
  const [p] = await h.db.insert(participants).values({ lineUserId }).returning();
  return p;
}

describe("migration / seed", () => {
  it("PGlite 上 migration 成功，seed 建立 3 景點 3 獎品且可重複執行", async () => {
    expect(await seed(h.db)).toEqual({ spots: 3, prizes: 3 });
    expect(await seed(h.db)).toEqual({ spots: 0, prizes: 0 });
    expect(await h.db.select().from(spots)).toHaveLength(3);
    expect(await h.db.select().from(prizes)).toHaveLength(3);
  });
});

describe("唯一性約束", () => {
  it("submissions.line_message_id 不可重複", async () => {
    const p = await newParticipant();
    const row = {
      participantId: p.id,
      lineMessageId: "m1",
      storageKey: "k1",
      status: "pending_spot" as const,
    };
    await h.db.insert(submissions).values(row);
    await expect(
      h.db.insert(submissions).values({ ...row, storageKey: "k2" }),
    ).rejects.toThrow();
    await h.db.insert(submissions).values({ ...row, lineMessageId: "m2" });
  });

  it("webhook_events.webhook_event_id 不可重複", async () => {
    await h.db.insert(webhookEvents).values({ webhookEventId: "e1" });
    await expect(
      h.db.insert(webhookEvents).values({ webhookEventId: "e1" }),
    ).rejects.toThrow();
  });

  it("participants.employee_no 唯一，但允許多個 NULL", async () => {
    await h.db.insert(participants).values({ lineUserId: "U1", employeeNo: "E001" });
    await expect(
      h.db.insert(participants).values({ lineUserId: "U2", employeeNo: "E001" }),
    ).rejects.toThrow();
    await h.db.insert(participants).values([{ lineUserId: "U3" }, { lineUserId: "U4" }]);
  });

  it("draw_runs 同時只能有一筆非 cancelled", async () => {
    const [a] = await h.db.insert(drawRuns).values({ status: "locked" }).returning();
    await expect(h.db.insert(drawRuns).values({ status: "locked" })).rejects.toThrow();
    await h.db.update(drawRuns).set({ status: "cancelled" }).where(eq(drawRuns.id, a.id));
    await h.db.insert(drawRuns).values({ status: "locked" });
    await h.db.insert(drawRuns).values({ status: "cancelled" });
  });

  it("prizes.quantity 必須大於 0", async () => {
    await expect(
      h.db.insert(prizes).values({ name: "x", quantity: 0, drawOrder: 1 }),
    ).rejects.toThrow();
  });
});
