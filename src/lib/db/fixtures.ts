import type { Db } from "./client";
import { participants, spots, submissions } from "./schema";

/**
 * 展示／E2E 用假資料（全為虛構，不含個資）。僅在 APP_ENV=test 且
 * ADMIN_FIXTURES=1 時由 getDb() 載入記憶體 PGlite；不會碰真實資料庫。
 */
export async function seedFixtures(db: Db): Promise<void> {
  const [a, b] = await db
    .insert(spots)
    .values([
      { name: "測試景點甲", sortOrder: 1 },
      { name: "測試景點乙", sortOrder: 2 },
    ])
    .returning({ id: spots.id });
  const [p1, p2, p3] = await db
    .insert(participants)
    .values([
      { lineUserId: "U-fixture-1", employeeNo: "T0001", displayName: "假員工一", status: "active", registeredAt: new Date("2026-10-01T01:00:00Z") },
      { lineUserId: "U-fixture-2", employeeNo: "T0002", displayName: "假員工二", status: "active", registeredAt: new Date("2026-10-02T01:00:00Z") },
      { lineUserId: "U-fixture-3", displayName: "假員工三", status: "pending_registration" },
    ])
    .returning({ id: participants.id });
  await db.insert(submissions).values([
    { participantId: p1.id, spotId: a.id, lineMessageId: "fx-1", storageKey: "fx/1.jpg", contentType: "image/jpeg", sizeBytes: 2048, status: "approved", createdAt: new Date("2026-10-03T01:00:00Z") },
    { participantId: p1.id, spotId: b.id, lineMessageId: "fx-2", storageKey: "fx/2.jpg", contentType: "image/jpeg", sizeBytes: 4096, status: "pending_review", createdAt: new Date("2026-10-03T02:00:00Z") },
    { participantId: p2.id, spotId: a.id, lineMessageId: "fx-3", storageKey: "fx/3.jpg", contentType: "image/png", sizeBytes: 1024, status: "rejected", rejectReason: "照片模糊", createdAt: new Date("2026-10-03T03:00:00Z") },
    { participantId: p2.id, lineMessageId: "fx-4", storageKey: "fx/4.jpg", contentType: "image/jpeg", sizeBytes: 3000, status: "pending_spot", createdAt: new Date("2026-10-03T04:00:00Z") },
  ]);
  void p3;
}
