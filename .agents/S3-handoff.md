# S3 交接

## 做了什麼
- `src/lib/line/signature.ts`：`computeSignature`／`verifySignature`（HMAC-SHA256 + Base64，`timingSafeEqual`；缺簽章或 secret 一律失敗）。與官方 SDK `validateSignature` 交叉測試。
- `src/lib/line/webhook.ts`：`receiveWebhook`（驗簽→JSON 解析→逐事件 `INSERT ... ON CONFLICT DO NOTHING` 寫入 `webhook_events`→回應→`schedule` 處理「新插入」的事件）與 `processEvents`（結果寫回 processed／failed）。核心與框架無關，route 只負責傳入 `after()`。
- `POST /api/line/webhook`（nodejs runtime）：簽章錯 401（不寫 DB）、JSON 壞 400、secret 未設 500。
- `src/lib/line/client.ts`：`LineClient` 最小介面＋`@line/bot-sdk` 11.4.0 `messagingApi.MessagingApiClient` 實作（token 只讀 `LINE_CHANNEL_ACCESS_TOKEN`）。
- Handlers（`handlers/`）：follow（建立／恢復，先 reply 歡迎再取 profile，profile 失敗不影響）、unfollow（停權者不變）、message.text（說明／打卡／進度，NFKC 正規化）、非文字（貼圖等回「請傳照片喔」，圖片暫不處理）、postback 路由表（`postbackRoutes`，`prefix:payload`）、group（join 自動退出、leave 僅記錄、群組內訊息不處理）。
- `messages.ts`：範本變數 `{eventName}`、`{command}`、主選單 Quick Reply、各文字 builder。
- `scripts/fake-webhook.ts`：`LINE_CHANNEL_SECRET=<假值> pnpm exec tsx scripts/fake-webhook.ts <follow|text|image|postback> [參數]`，`WEBHOOK_URL` 可覆寫目標。
- 測試：signature、webhook 整合（PGlite＋mock client：驗簽成功／失敗、重複 id、同批重複、handler 失敗、各 handler、回應時間 < 300ms）、route 層測試。共 47 項。

## 驗證
lint、typecheck、test、build 本機通過。本機沒有 Docker／Postgres／真實 OA，**未實機驗證**；以 `next start` 確認錯誤簽章回 401。有 DB 的完整 fake-webhook 流程請在有 `DATABASE_URL` 的環境跑。

## 決策／注意
- 「打卡」「進度」對已報名者目前回「尚未開放」（S4/S5 實作）；指令開頭文字在 S3b 掛上 `registrationHandler.current` 前也回「尚未開放」。S3b 只要註冊該函式（回 true 表示已處理）。
- 去重以「是否成功插入」判斷；事件若在 `received` 時行程重啟，重送會被視為重複而不處理——需靠架構文件的補償掃描（尚未實作，建議後續階段補）。
- 實機驗收項（加好友收歡迎訊息、完成報名、輸入說明）因 OA 暫緩未做。
- 回應時間：整合測試斷言 < 300ms（PGlite，不含 after）。
- 未新增環境變數；沒有任何真實金鑰，測試用 `test-secret-not-real`。
