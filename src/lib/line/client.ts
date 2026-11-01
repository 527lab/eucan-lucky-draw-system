import { messagingApi } from "@line/bot-sdk";

/** 業務程式只依賴這個最小介面，測試時以 mock 取代。 */
export type LineMessage = messagingApi.Message;

export interface LineClient {
  replyMessage(replyToken: string, messages: LineMessage[]): Promise<void>;
  getProfile(userId: string): Promise<{ displayName: string; pictureUrl?: string }>;
  leaveGroup(groupId: string): Promise<void>;
  leaveRoom(roomId: string): Promise<void>;
}

/** 以環境變數中的 access token 建立真實 client；token 只從環境變數讀取。 */
export function createLineClient(
  channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN,
): LineClient {
  if (!channelAccessToken) throw new Error("LINE_CHANNEL_ACCESS_TOKEN 未設定");
  const api = new messagingApi.MessagingApiClient({ channelAccessToken });
  return {
    async replyMessage(replyToken, messages) {
      await api.replyMessage({ replyToken, messages });
    },
    async getProfile(userId) {
      const p = await api.getProfile(userId);
      return { displayName: p.displayName, pictureUrl: p.pictureUrl };
    },
    async leaveGroup(groupId) {
      await api.leaveGroup(groupId);
    },
    async leaveRoom(roomId) {
      await api.leaveRoom(roomId);
    },
  };
}

let shared: LineClient | undefined;
export function getLineClient(): LineClient {
  shared ??= createLineClient();
  return shared;
}
