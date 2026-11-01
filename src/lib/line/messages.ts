import type { LineMessage } from "./client";
import type { Settings } from "../settings";

/** 取代範本中的 {name} 之類的變數；未提供的變數保留原樣。 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

export const KEYWORDS = { checkin: "打卡", progress: "進度", help: "說明" } as const;

/** 主選單 Quick Reply（message action，點選等同輸入關鍵字）。 */
export function mainMenuQuickReply() {
  return {
    items: Object.values(KEYWORDS).map((label) => ({
      type: "action" as const,
      action: { type: "message" as const, label, text: label },
    })),
  };
}

export function textMessage(text: string, withMenu = false): LineMessage {
  return withMenu
    ? { type: "text", text, quickReply: mainMenuQuickReply() }
    : { type: "text", text };
}

export function welcomeMessage(s: Settings): LineMessage {
  return textMessage(
    renderTemplate(s["messages.welcome"], {
      eventName: s["event.name"],
      command: s["registration.command"],
    }),
  );
}

export function rulesMessage(s: Settings): LineMessage {
  return textMessage(renderTemplate(s["messages.rules"], { eventName: s["event.name"] }), true);
}

export function notRegisteredMessage(s: Settings): LineMessage {
  const c = s["registration.command"];
  return textMessage(`請先完成報名：輸入「${c} 員工編號」，例如「${c} A1234」。`);
}

export function fallbackMessage(): LineMessage {
  return textMessage("不太懂您的意思，可以輸入下列關鍵字：", true);
}

export const askForPhotoMessage = (): LineMessage => textMessage("請傳照片喔");
export const notAvailableYetMessage = (): LineMessage => textMessage("此功能尚未開放，敬請期待。");
