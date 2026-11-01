import { z } from "zod";

/** 業務設定（spec.md §7.2）：鍵 → zod schema（含預設值）。 */
const datetime = z.iso.datetime({ offset: true }).nullable();

export const settingsSchemas = {
  "event.name": z.string().min(1).default("EUCAN 2027 員工旅遊"),
  "event.timezone": z.string().min(1).default("Asia/Taipei"),
  "registration.command": z.string().min(1).default("參加"),
  "employees.source": z.enum(["csv", "leave-api"]).default("csv"),
  "upload.startAt": datetime.default(null),
  "upload.deadlineAt": datetime.default(null),
  "upload.pendingSpotTtlMinutes": z.number().int().positive().default(10),
  "upload.maxPerSpotPerUser": z.number().int().positive().default(5),
  "review.mode": z.enum(["auto", "manual"]).default("auto"),
  "ticket.mode": z.enum(["per_spot", "complete_all", "threshold"]).default("per_spot"),
  "ticket.maxPerUser": z.number().int().positive().nullable().default(null),
  "ticket.minSpots": z.number().int().positive().default(1),
  "ticket.ticketsWhenComplete": z.number().int().positive().default(1),
  "ticket.keepOnUnfollow": z.boolean().default(true),
  "draw.allowMultipleWins": z.boolean().default(false),
  "draw.scheduledAt": datetime.default(null),
  "draw.autoNotify": z.boolean().default(false),
  "notify.onApprove": z.boolean().default(false),
  "notify.onReject": z.boolean().default(false),
  "notify.announceToAll": z.boolean().default(false),
  "privacy.purgeAfterDays": z.number().int().positive().default(30),
  "messages.welcome": z
    .string()
    .default("歡迎參加 {eventName}！請輸入「{command} 員工編號」完成報名。"),
  "messages.rules": z
    .string()
    .default("到各景點拍照上傳即可獲得抽獎券，券數越多中獎機率越高。"),
  "messages.winnerTemplate": z
    .string()
    .default("恭喜 {name} 抽中「{prize}」！請洽活動工作人員領獎。"),
} as const;

export type SettingKey = keyof typeof settingsSchemas;
export type Settings = { [K in SettingKey]: z.output<(typeof settingsSchemas)[K]> };

export const SETTING_KEYS = Object.keys(settingsSchemas) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(settingsSchemas, key);
}

/** 抽獎鎖定後唯讀的設定（spec.md §7.3）。 */
export function isLockableKey(key: string): boolean {
  return key.startsWith("ticket.") || key === "review.mode";
}

export function getDefaults(): Settings {
  const out: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) out[key] = settingsSchemas[key].parse(undefined);
  return out as Settings;
}
