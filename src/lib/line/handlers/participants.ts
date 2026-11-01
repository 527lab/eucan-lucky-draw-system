import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { participants } from "../../db/schema";

export async function findParticipant(db: Db, lineUserId: string) {
  const [row] = await db
    .select()
    .from(participants)
    .where(eq(participants.lineUserId, lineUserId));
  return row;
}

/** 已通過報名且可使用功能者。 */
export function isActive(p: { status: string } | undefined): boolean {
  return p?.status === "active";
}
