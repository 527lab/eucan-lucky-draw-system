import type { webhook } from "@line/bot-sdk";
import type { Db } from "../../db/client";
import type { PhotoStorage } from "../../storage";
import type { LineClient } from "../client";

export type LineEvent = webhook.Event;
export type HandlerContext = {
  db: Db;
  client: LineClient;
  now: () => Date;
  /** 延遲取得，避免沒有圖片事件時就要求 PHOTO_STORAGE_DIR。 */
  storage: () => PhotoStorage;
};

export function sourceUserId(event: LineEvent): string | undefined {
  const s = event.source;
  return s?.type === "user" ? s.userId : undefined;
}
