import type { Db } from "../db/client";
import type { Settings } from "../settings";
import { isDrawLocked } from "../settings";

export type UploadBlock = "not_started" | "deadline_passed" | "draw_locked";

type SpotWindow = { active: boolean; availableFrom: Date | null; availableUntil: Date | null };

/** 景點目前是否開放：active 且在 available_from/until 區間內（until 為開區間）。 */
export function isSpotOpen(spot: SpotWindow, now: Date): boolean {
  if (!spot.active) return false;
  if (spot.availableFrom && now < spot.availableFrom) return false;
  if (spot.availableUntil && now >= spot.availableUntil) return false;
  return true;
}

/** 全域上傳限制（與景點無關）：開始時間、截止時間、抽獎是否已鎖定。 */
export async function checkUploadWindow(
  db: Db,
  settings: Settings,
  now: Date,
): Promise<UploadBlock | null> {
  if (await isDrawLocked(db)) return "draw_locked";
  const start = settings["upload.startAt"];
  if (start && now < new Date(start)) return "not_started";
  const deadline = settings["upload.deadlineAt"];
  if (deadline && now > new Date(deadline)) return "deadline_passed";
  return null;
}

export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
