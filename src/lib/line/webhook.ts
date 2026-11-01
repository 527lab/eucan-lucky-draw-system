import { eq } from "drizzle-orm";
import type { webhook } from "@line/bot-sdk";
import type { Db } from "../db/client";
import { webhookEvents } from "../db/schema";
import type { LineClient } from "./client";
import { dispatchEvent, type LineEvent } from "./handlers";
import { sourceUserId } from "./handlers/types";
import { getStorage, type PhotoStorage } from "../storage";
import { verifySignature } from "./signature";

export type WebhookDeps = {
  db: Db;
  client: () => LineClient;
  channelSecret: string | undefined;
  /** 回應後執行的工作（route 傳入 next/server 的 after）。 */
  schedule: (task: () => Promise<void>) => void;
  storage?: () => PhotoStorage;
  now?: () => Date;
};

export type WebhookResult = { status: 200 | 400 | 401 | 500; body: Record<string, unknown> };

/** 驗簽 → 寫入 webhook_events（去重）→ 回應 → 排程處理新事件。 */
export async function receiveWebhook(
  rawBody: string,
  signature: string | null,
  deps: WebhookDeps,
): Promise<WebhookResult> {
  if (!deps.channelSecret) return { status: 500, body: { error: "server misconfigured" } };
  if (!verifySignature(rawBody, signature, deps.channelSecret)) {
    return { status: 401, body: { error: "invalid signature" } };
  }

  let parsed: webhook.CallbackRequest;
  try {
    parsed = JSON.parse(rawBody) as webhook.CallbackRequest;
  } catch {
    return { status: 400, body: { error: "invalid json" } };
  }
  const events = Array.isArray(parsed?.events) ? parsed.events : [];

  const fresh: LineEvent[] = [];
  for (const event of events) {
    if (!event.webhookEventId) continue;
    const inserted = await deps.db
      .insert(webhookEvents)
      .values({
        webhookEventId: event.webhookEventId,
        type: event.type,
        lineUserId: sourceUserId(event) ?? null,
        isRedelivery: event.deliveryContext?.isRedelivery ?? false,
        payload: event,
      })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.webhookEventId });
    if (inserted.length > 0) fresh.push(event);
  }

  if (fresh.length > 0) deps.schedule(() => processEvents(fresh, deps));
  return { status: 200, body: { received: events.length, queued: fresh.length } };
}

/** 依序處理事件，並把結果寫回 webhook_events；單一事件失敗不影響其他事件。 */
export async function processEvents(events: LineEvent[], deps: WebhookDeps) {
  const now = deps.now ?? (() => new Date());
  for (const event of events) {
    const where = eq(webhookEvents.webhookEventId, event.webhookEventId);
    try {
      await dispatchEvent(
        { db: deps.db, client: deps.client(), now, storage: deps.storage ?? getStorage },
        event,
      );
      await deps.db
        .update(webhookEvents)
        .set({ status: "processed", processedAt: now() })
        .where(where);
    } catch (err) {
      console.error("[line] 事件處理失敗", {
        webhookEventId: event.webhookEventId,
        error: String(err),
      });
      await deps.db
        .update(webhookEvents)
        .set({ status: "failed", error: String(err), processedAt: now() })
        .where(where);
    }
  }
}
