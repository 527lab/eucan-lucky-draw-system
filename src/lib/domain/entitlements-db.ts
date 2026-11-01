import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { participants, spots, submissions, ticketAdjustments } from "../db/schema";
import type { Settings } from "../settings";
import { computeEntitlements, type Entitlement } from "./entitlements";

/** 讀取資料後交給純函式 computeEntitlements；省略 participantId 則計算全部參加者。 */
export async function loadEntitlements(
  db: Db,
  settings: Settings,
  participantId?: string,
): Promise<Map<string, Entitlement>> {
  const ps = await db
    .select({ id: participants.id, status: participants.status })
    .from(participants)
    .where(participantId ? eq(participants.id, participantId) : undefined);
  const ids = ps.map((p) => p.id);
  if (ids.length === 0) return new Map();
  const [subs, allSpots, adjs] = await Promise.all([
    db
      .select({
        participantId: submissions.participantId,
        spotId: submissions.spotId,
        status: submissions.status,
      })
      .from(submissions)
      .where(inArray(submissions.participantId, ids)),
    db.select().from(spots),
    db
      .select({ participantId: ticketAdjustments.participantId, delta: ticketAdjustments.delta })
      .from(ticketAdjustments)
      .where(inArray(ticketAdjustments.participantId, ids)),
  ]);
  return computeEntitlements(
    settings,
    ps,
    subs.filter((s) => s.status === "approved"),
    allSpots,
    adjs,
  );
}

export async function ticketsFor(db: Db, settings: Settings, participantId: string): Promise<number> {
  return (await loadEntitlements(db, settings, participantId)).get(participantId)?.tickets ?? 0;
}
