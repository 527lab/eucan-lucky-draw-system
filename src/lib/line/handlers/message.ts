import { getSettings } from "../../settings";
import {
  askForPhotoMessage,
  fallbackMessage,
  KEYWORDS,
  notAvailableYetMessage,
  notRegisteredMessage,
  rulesMessage,
} from "../messages";
import { findParticipant, isActive } from "./participants";
import { sourceUserId, type HandlerContext, type LineEvent } from "./types";

/** 全形轉半形（NFKC）並 trim，讓全形輸入也能比對。 */
export function normalizeText(text: string): string {
  return text.normalize("NFKC").trim();
}

/**
 * 報名（指令＋員工編號）的解析與查證由 S3b 實作，S3b 把處理函式放進 `current`。
 * 回傳 true 表示已處理並回覆。目前未註冊時，指令開頭的文字回「尚未開放」。
 */
export type RegistrationHandler = (
  ctx: HandlerContext,
  event: LineEvent,
  text: string,
) => Promise<boolean>;
export const registrationHandler: { current: RegistrationHandler | null } = { current: null };

export async function handleMessage(ctx: HandlerContext, event: LineEvent) {
  if (event.type !== "message") return;
  const userId = sourceUserId(event);
  if (!userId) return; // 群組／多人聊天室不處理
  const replyToken = event.replyToken;
  if (!replyToken) return;
  const { db, client } = ctx;
  const settings = await getSettings(db);

  if (event.message.type !== "text") {
    // 圖片的下載與建檔屬 S5；其他類型（貼圖、影片、位置…）回覆請傳照片。
    if (event.message.type === "image") return;
    await client.replyMessage(replyToken, [askForPhotoMessage()]);
    return;
  }

  const text = normalizeText(event.message.text);
  const command = normalizeText(settings["registration.command"]);

  if (text.startsWith(command) && registrationHandler.current) {
    if (await registrationHandler.current(ctx, event, text)) return;
  }

  switch (text) {
    case KEYWORDS.help:
      await client.replyMessage(replyToken, [rulesMessage(settings)]);
      return;
    case KEYWORDS.checkin:
    case KEYWORDS.progress: {
      const participant = await findParticipant(db, userId);
      if (!isActive(participant)) {
        await client.replyMessage(replyToken, [notRegisteredMessage(settings)]);
        return;
      }
      // 景點選擇與進度查詢屬 S4/S5。
      await client.replyMessage(replyToken, [notAvailableYetMessage()]);
      return;
    }
  }

  if (text.startsWith(command)) {
    await client.replyMessage(replyToken, [notAvailableYetMessage()]); // S3b 前的暫時回應
    return;
  }
  await client.replyMessage(replyToken, [fallbackMessage()]);
}
