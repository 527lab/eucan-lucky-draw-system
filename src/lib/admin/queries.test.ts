import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "@/lib/db/test-helper";
import type { DbHandle } from "@/lib/db/client";
import { seedFixtures } from "@/lib/db/fixtures";
import {
  listParticipants,
  listSpotOptions,
  listSubmissions,
  parseSubmissionStatus,
} from "./queries";

let h: DbHandle;
beforeAll(async () => {
  h = await createTestDb();
  await seedFixtures(h.db);
});
afterAll(() => h.close());

describe("parseSubmissionStatus", () => {
  it("只接受合法狀態", () => {
    expect(parseSubmissionStatus("approved")).toBe("approved");
    expect(parseSubmissionStatus("x")).toBeUndefined();
    expect(parseSubmissionStatus(undefined)).toBeUndefined();
  });
});

describe("listSubmissions", () => {
  it("全部列出，新到舊，未選景點 spotName 為 null", async () => {
    const rows = await listSubmissions(h.db);
    expect(rows).toHaveLength(4);
    expect(rows[0].status).toBe("pending_spot");
    expect(rows[0].spotName).toBeNull();
    expect(rows[3].status).toBe("approved");
  });
  it("依狀態篩選", async () => {
    const rows = await listSubmissions(h.db, { status: "rejected" });
    expect(rows).toHaveLength(1);
    expect(rows[0].rejectReason).toBe("照片模糊");
    expect(rows[0].employeeNo).toBe("T0002");
  });
  it("依景點篩選並可與狀態組合", async () => {
    const [a] = await listSpotOptions(h.db);
    expect(await listSubmissions(h.db, { spotId: a.id })).toHaveLength(2);
    expect(await listSubmissions(h.db, { spotId: a.id, status: "approved" })).toHaveLength(1);
  });
  it("limit 生效", async () => {
    expect(await listSubmissions(h.db, { limit: 2 })).toHaveLength(2);
  });
});

describe("listParticipants", () => {
  it("含照片數與已通過數，沒照片者為 0", async () => {
    const rows = await listParticipants(h.db);
    expect(rows).toHaveLength(3);
    const by = Object.fromEntries(rows.map((r) => [r.displayName, r]));
    expect(by["假員工一"]).toMatchObject({ submissionCount: 2, approvedCount: 1 });
    expect(by["假員工二"]).toMatchObject({ submissionCount: 2, approvedCount: 0 });
    expect(by["假員工三"]).toMatchObject({ submissionCount: 0, approvedCount: 0 });
  });
});

describe("listSpotOptions", () => {
  it("依排序列出景點", async () => {
    expect((await listSpotOptions(h.db)).map((s) => s.name)).toEqual([
      "測試景點甲",
      "測試景點乙",
    ]);
  });
});
