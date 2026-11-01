import type { messagingApi } from "@line/bot-sdk";
import type { LineMessage } from "../line/client";
import { textMessage } from "../line/messages";
import type { Settings } from "../settings";
import { formatTime, type UploadBlock } from "./rules";

export const QUICK_REPLY_LIMIT = 13;
const BUBBLE_ROWS = 8; // 每個 bubble 最多幾個景點按鈕
const MAX_BUBBLES = 12; // Flex carousel 上限

type SpotChoice = { id: string; name: string };

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * 景點選單：≤13 個用 Quick Reply（postback），超過改用 Flex carousel。
 * `dataFor` 產生每個景點的 postback data（例如 `spot:<id>`、`assign:<sid>:<spotId>`）。
 */
export function spotChoiceMessage(
  prompt: string,
  spots: SpotChoice[],
  dataFor: (spotId: string) => string,
): LineMessage {
  if (spots.length <= QUICK_REPLY_LIMIT) {
    return {
      type: "text",
      text: prompt,
      quickReply: {
        items: spots.map((s) => ({
          type: "action" as const,
          action: {
            type: "postback" as const,
            label: cut(s.name, 20),
            data: dataFor(s.id),
            displayText: s.name,
          },
        })),
      },
    };
  }
  const bubbles: messagingApi.FlexBubble[] = [];
  for (let i = 0; i < spots.length && bubbles.length < MAX_BUBBLES; i += BUBBLE_ROWS) {
    const chunk = spots.slice(i, i + BUBBLE_ROWS);
    bubbles.push({
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          { type: "text", text: prompt, wrap: true, weight: "bold", size: "sm" },
          ...chunk.map(
            (s): messagingApi.FlexComponent => ({
              type: "button",
              style: "secondary",
              height: "sm",
              action: { type: "postback", label: cut(s.name, 20), data: dataFor(s.id), displayText: s.name },
            }),
          ),
        ],
      },
    });
  }
  return {
    type: "flex",
    altText: prompt,
    contents: { type: "carousel", contents: bubbles },
  };
}

export const noOpenSpotsMessage = (): LineMessage => textMessage("目前沒有開放的景點，請稍後再試。", true);

export function chooseSpotPrompt(): string {
  return "請選擇要上傳照片的景點：";
}
export function whichSpotPrompt(): string {
  return "這張照片是哪個景點？";
}

export function sendPhotoMessage(spotName: string): LineMessage {
  return {
    type: "text",
    text: `請傳送「${spotName}」的合照（可一次傳多張）。`,
    quickReply: {
      items: [
        { type: "action", action: { type: "camera", label: "相機" } },
        { type: "action", action: { type: "cameraRoll", label: "相簿" } },
      ],
    },
  };
}

export function blockedMessage(block: UploadBlock, s: Settings): LineMessage {
  switch (block) {
    case "draw_locked":
      return textMessage("抽獎已經開始，無法再上傳照片了。");
    case "deadline_passed":
      return textMessage("已超過上傳截止時間，無法再上傳照片了。");
    case "not_started": {
      const at = s["upload.startAt"];
      return textMessage(
        at ? `上傳尚未開始，開放時間：${formatTime(at, s["event.timezone"])}` : "上傳尚未開始。",
      );
    }
  }
}

export const spotClosedMessage = (name: string): LineMessage =>
  textMessage(`「${name}」目前不在開放時間內，請選擇其他景點。`);
export const spotLimitMessage = (name: string, max: number): LineMessage =>
  textMessage(`「${name}」最多可上傳 ${max} 張照片，已達上限。`);
export const photoApprovedMessage = (spotName: string, tickets: number): LineMessage =>
  textMessage(`✅ 已收到「${spotName}」景點照片，目前 ${tickets} 張抽獎券`, true);
export const photoPendingReviewMessage = (): LineMessage =>
  textMessage("已收到，審核通過後計入", true);
export const photoAlreadyAssignedMessage = (): LineMessage => textMessage("這張照片已經選過景點了。", true);
export const assignNotFoundMessage = (): LineMessage => textMessage("找不到這張照片，請重新上傳。", true);
export const photoFailedMessage = (): LineMessage =>
  textMessage("照片處理時發生問題，請稍後再傳一次。");
