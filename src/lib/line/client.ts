import { messagingApi } from "@line/bot-sdk";

/** 業務程式只依賴這個最小介面，測試時以 mock 取代。 */
export type LineMessage = messagingApi.Message;

export interface LineClient {
  replyMessage(replyToken: string, messages: LineMessage[]): Promise<void>;
  getProfile(userId: string): Promise<{ displayName: string; pictureUrl?: string }>;
  leaveGroup(groupId: string): Promise<void>;
  leaveRoom(roomId: string): Promise<void>;
  /** 下載使用者傳送的內容（api-data.line.me）；失敗丟例外。 */
  getMessageContent(messageId: string): Promise<{ data: Buffer; contentType: string }>;
  /** 顯示「輸入中」動畫（選用，呼叫端需自行吞掉失敗）。 */
  showLoading(userId: string, seconds?: number): Promise<void>;
}

/** 以環境變數中的 access token 建立真實 client；token 只從環境變數讀取。 */
export function createLineClient(
  channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN,
): LineClient {
  if (!channelAccessToken) throw new Error("LINE_CHANNEL_ACCESS_TOKEN 未設定");
  const api = new messagingApi.MessagingApiClient({ channelAccessToken });
  const blob = new messagingApi.MessagingApiBlobClient({ channelAccessToken });
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
    async getMessageContent(messageId) {
      const res = await blob.getMessageContentWithHttpInfo(messageId);
      const chunks: Buffer[] = [];
      for await (const chunk of res.body) chunks.push(Buffer.from(chunk));
      return {
        data: Buffer.concat(chunks),
        contentType: res.httpResponse.headers.get("content-type") ?? "image/jpeg",
      };
    },
    async showLoading(userId, seconds = 5) {
      await api.showLoadingAnimation({ chatId: userId, loadingSeconds: seconds });
    },
  };
}

let shared: LineClient | undefined;
export function getLineClient(): LineClient {
  shared ??= createLineClient();
  return shared;
}
