/**
 * 本機測試用：以環境變數中的 LINE_CHANNEL_SECRET 簽章後，送出指定類型的假 webhook 事件。
 * 用法：LINE_CHANNEL_SECRET=<測試用假值> tsx scripts/fake-webhook.ts <follow|text|image|postback> [參數]
 *   follow   [userId]
 *   text     <內容> [userId]
 *   image    [userId]
 *   postback <data> [userId]
 * 目標網址：環境變數 WEBHOOK_URL，預設 http://localhost:3000/api/line/webhook。
 * secret 只讀環境變數，絕不寫進檔案。
 */
import { randomUUID } from "node:crypto";
import { computeSignature } from "../src/lib/line/signature";

export function buildEvent(type: string, args: string[], userId: string) {
  const base = {
    mode: "active",
    timestamp: Date.now(),
    source: { type: "user", userId },
    webhookEventId: randomUUID(),
    deliveryContext: { isRedelivery: false },
    replyToken: randomUUID().replaceAll("-", ""),
  };
  switch (type) {
    case "follow":
      return { ...base, type: "follow", follow: { isUnblocked: false } };
    case "text":
      return {
        ...base,
        type: "message",
        message: { type: "text", id: String(Date.now()), text: args[0] ?? "說明" },
      };
    case "image":
      return {
        ...base,
        type: "message",
        message: {
          type: "image",
          id: String(Date.now()),
          contentProvider: { type: "line" },
        },
      };
    case "postback":
      return { ...base, type: "postback", postback: { data: args[0] ?? "noop:" } };
    default:
      throw new Error(`不支援的類型：${type}（follow | text | image | postback）`);
  }
}

async function main() {
  const [type, ...rest] = process.argv.slice(2);
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!type) throw new Error("請指定事件類型：follow | text | image | postback");
  if (!secret) throw new Error("請以環境變數 LINE_CHANNEL_SECRET 提供測試用 secret");

  const takesArg = type === "text" || type === "postback";
  const userId = (takesArg ? rest[1] : rest[0]) ?? "Utest00000000000000000000000001";
  const event = buildEvent(type, takesArg ? rest : [], userId);
  const body = JSON.stringify({ destination: "Utest-destination", events: [event] });
  const url = process.env.WEBHOOK_URL ?? "http://localhost:3000/api/line/webhook";

  const started = performance.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-line-signature": computeSignature(body, secret),
    },
    body,
  });
  const ms = Math.round(performance.now() - started);
  console.log(`${res.status} ${await res.text()} (${ms}ms)`);
  if (!res.ok) process.exitCode = 1;
}

if (process.argv[1]?.includes("fake-webhook")) {
  main().catch((err) => {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  });
}
