import type { webhook } from "@line/bot-sdk";
import type { Db } from "../../db/client";
import type { LineClient } from "../client";

export type LineEvent = webhook.Event;
export type HandlerContext = { db: Db; client: LineClient; now: () => Date };

export function sourceUserId(event: LineEvent): string | undefined {
  const s = event.source;
  return s?.type === "user" ? s.userId : undefined;
}
