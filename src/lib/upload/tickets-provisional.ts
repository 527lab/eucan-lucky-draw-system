import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { spots, submissions } from "../db/schema";
import type { Settings } from "../settings";

/**
 * 暫時的券數計算（僅供 S4 回覆「目前 N 張券」）。
 * TODO(S5)：改用 `computeEntitlements`（含手動調整、封鎖者、停權者等情境）。
 */
export async function provisionalTickets(
  db: Db,
  participantId: string,
  settings: Settings,
): Promise<number> {
  const done = await db
    .selectDistinct({ spotId: submissions.spotId, counts: spots.countsForTicket, required: spots.required })
    .from(submissions)
    .innerJoin(spots, eq(spots.id, submissions.spotId))
    .where(and(eq(submissions.participantId, participantId), eq(submissions.status, "approved")));
  const counted = done.filter((d) => d.counts);
  let tickets = 0;
  switch (settings["ticket.mode"]) {
    case "per_spot":
      tickets = counted.length;
      break;
    case "complete_all": {
      const required = await db.select({ id: spots.id }).from(spots).where(
        and(eq(spots.active, true), eq(spots.required, true), eq(spots.countsForTicket, true)),
      );
      const have = new Set(counted.map((d) => d.spotId));
      tickets =
        required.length > 0 && required.every((r) => have.has(r.id))
          ? settings["ticket.ticketsWhenComplete"]
          : 0;
      break;
    }
    case "threshold":
      tickets =
        counted.length >= settings["ticket.minSpots"] ? settings["ticket.ticketsWhenComplete"] : 0;
      break;
  }
  const max = settings["ticket.maxPerUser"];
  return max === null ? tickets : Math.min(tickets, max);
}
