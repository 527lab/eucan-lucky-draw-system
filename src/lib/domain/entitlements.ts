/**
 * 資格計算引擎（純函式，禁止任何 I/O：不得 import db、fs、網路、時間或亂數；
 * eslint.config.mjs 以 no-restricted-imports 強制）。
 * 規則見 docs/spec.md §5。
 */
import type { Settings } from "../settings/schema";

export type ParticipantStatus = "pending_registration" | "active" | "blocked" | "unfollowed";

export interface EntParticipant {
  id: string;
  status: ParticipantStatus;
}
export interface EntSpot {
  id: string;
  active: boolean;
  required: boolean;
  countsForTicket: boolean;
}
export interface EntSubmission {
  participantId: string;
  spotId: string | null;
  /** 傳入時只計 "approved"；其他狀態一律忽略（防呆）。 */
  status: string;
}
export interface EntAdjustment {
  participantId: string;
  delta: number;
}
export interface Entitlement {
  tickets: number;
  /** 已通過的不重複景點（含 counts_for_ticket=false 者，供進度顯示）。 */
  completedSpotIds: string[];
  eligible: boolean;
}

export type EntitlementSettings = Pick<
  Settings,
  | "ticket.mode"
  | "ticket.maxPerUser"
  | "ticket.minSpots"
  | "ticket.ticketsWhenComplete"
  | "ticket.keepOnUnfollow"
>;

/**
 * 資格規則：
 * - 每人每景點最多算 1 次；只計 counts_for_ticket=true 的景點。
 * - per_spot：景點數；complete_all：完成全部「啟用且必填且計券」景點才給
 *   ticketsWhenComplete 張；threshold：計券景點數 ≥ minSpots 才給 ticketsWhenComplete 張。
 * - maxPerUser 上限套用於三種模式的基本券數（規格只明寫 per_spot，沿用 S4 暫用函式行為）。
 * - 之後加手動調整（可負），結果最小為 0。
 * - 停權（blocked）與未完成報名者恆為 0 張；unfollowed 依 keepOnUnfollow。
 * 回傳的 Map 對每位傳入的參加者都有一筆。
 */
export function computeEntitlements(
  settings: EntitlementSettings,
  participants: readonly EntParticipant[],
  approvedSubmissions: readonly EntSubmission[],
  spots: readonly EntSpot[],
  adjustments: readonly EntAdjustment[],
): Map<string, Entitlement> {
  const spotById = new Map(spots.map((s) => [s.id, s]));
  const requiredIds = spots.filter((s) => s.active && s.required && s.countsForTicket).map((s) => s.id);

  const doneBy = new Map<string, Set<string>>();
  for (const sub of approvedSubmissions) {
    if (sub.status !== "approved" || sub.spotId === null || !spotById.has(sub.spotId)) continue;
    let set = doneBy.get(sub.participantId);
    if (!set) doneBy.set(sub.participantId, (set = new Set()));
    set.add(sub.spotId);
  }
  const adjBy = new Map<string, number>();
  for (const a of adjustments) adjBy.set(a.participantId, (adjBy.get(a.participantId) ?? 0) + a.delta);

  const result = new Map<string, Entitlement>();
  for (const p of participants) {
    const done = doneBy.get(p.id) ?? new Set<string>();
    const completedSpotIds = [...done];
    const allowed =
      p.status === "active" || (p.status === "unfollowed" && settings["ticket.keepOnUnfollow"]);
    if (!allowed) {
      result.set(p.id, { tickets: 0, completedSpotIds, eligible: false });
      continue;
    }
    const counted = completedSpotIds.filter((id) => spotById.get(id)!.countsForTicket);
    let base = 0;
    switch (settings["ticket.mode"]) {
      case "per_spot":
        base = counted.length;
        break;
      case "complete_all":
        base =
          requiredIds.length > 0 && requiredIds.every((id) => done.has(id))
            ? settings["ticket.ticketsWhenComplete"]
            : 0;
        break;
      case "threshold":
        base = counted.length >= settings["ticket.minSpots"] ? settings["ticket.ticketsWhenComplete"] : 0;
        break;
    }
    const max = settings["ticket.maxPerUser"];
    if (max !== null) base = Math.min(base, max);
    const tickets = Math.max(0, base + (adjBy.get(p.id) ?? 0));
    result.set(p.id, { tickets, completedSpotIds, eligible: tickets > 0 });
  }
  return result;
}
