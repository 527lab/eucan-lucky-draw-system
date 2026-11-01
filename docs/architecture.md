# 架構與技術選型（architecture.md）

> 版本：S0 草案（2026-11-01）。版本號是撰寫當下 npm 上的最新版，實作時以 `npm view <pkg> version` 為準。

## 1. 架構總覽

```text
 員工手機 (LINE App)
      │  傳照片 / 點選單
      ▼
 LINE Platform ──webhook (HTTPS POST, x-line-signature)──▶ Next.js on Vercel
      ▲                                                     │
      │ reply / push (api.line.me)                          ├─ /api/line/webhook   (Route Handler, Node runtime)
      │ get content (api-data.line.me)                      ├─ /admin/**            (App Router, Server Components + Server Actions)
      │                                                     ├─ /api/admin/photos/[id] (受保護的照片串流)
      └─────────────────────────────────────────────────────┤
                                                            ├──▶ Neon Postgres  (Drizzle ORM)
                                                            └──▶ Vercel Blob   (照片)
```

Webhook 處理時序：

```text
POST /api/line/webhook
  1. 讀 raw body（req.text()），用 LINE_CHANNEL_SECRET 做 HMAC-SHA256，與 x-line-signature 做 timing-safe 比對 → 不符就回 401
  2. JSON.parse → 每個 event 以 webhookEventId INSERT ... ON CONFLICT DO NOTHING 寫入 webhook_events
  3. 回 200（目標 < 1 秒）
  4. after(() => 依序處理新插入的 events)
       - follow / unfollow / message.text / message.image / postback
       - image：GET content → 上傳 Blob → 建 submission → reply
       - 失敗：webhook_events.status = failed，記錄 error，後台可以重跑
```

> 回 200 之後才處理，是因為 LINE 官方建議「非同步處理事件」，而且下載照片可能需要幾秒。Next.js 的 `after()`（`next/server`，從 15.1 開始穩定）在 Vercel 上會用 `waitUntil` 讓函式在回應後繼續執行到結束。
> Reply token 有時效而且只能用一次（官方錯誤碼包含 expired 和 used reply token），所以背景處理要**先回覆、再做非必要的工作**。如果 reply 失敗而且屬於 token 過期，就改用 push 補送，但只限重要訊息，避免用掉額度。

## 2. 技術選型與理由

| 層 | 選擇 | 版本（2026-11） | 理由 |
|---|---|---|---|
| 框架 | **Next.js（App Router）+ TypeScript strict** | next 16.4.x | 依需求優先。webhook 和後台放在同一個專案、一次部署；Server Actions 讓後台 CRUD 很省事 |
| 執行環境 | Node.js 22 LTS（Vercel Node runtime） | | `@line/bot-sdk` 和 `crypto` 需要 Node runtime。webhook route 要宣告 `export const runtime = 'nodejs'` |
| LINE SDK | **`@line/bot-sdk`**（官方） | 11.4.x | 官方維護，有 TypeScript 型別、`validateSignature`、`messagingApi.MessagingApiClient` 和 `MessagingApiBlobClient`（get content） |
| 資料庫 | **Neon Postgres（Free）** | | 免費方案的容量（0.5 GB）遠超過需求。Serverless driver 適合 Vercel。可以從 Vercel Marketplace 一鍵整合並自動注入 env。支援 branch，可以拿來做測試資料庫 |
| ORM | **Drizzle ORM + drizzle-kit** | 0.45.x | 輕量、沒有額外的 engine binary，冷啟動快，SQL 透明。測試可以用 PGlite（in-process Postgres），不需要 Docker |
| 照片儲存 | **Vercel Blob** | | 和 Vercel 整合最省事。40 人 × 10 張 × 約 0.5 MB ≈ 200 MB，在免費額度內。用隨機 key 存放，不對外公開網址，由後台路由代理讀取 |
| 部署 | **Vercel** | | Next.js 原生平台，push 就部署，有 Preview 環境。**注意：Hobby 方案限非商業用途**，見 4.3 |
| 驗證 | 自製密碼 + 簽章 cookie（`jose` 或 `iron-session`） | | 管理員 2–3 人，不需要 OAuth |
| 驗證資料 | `zod` | | 設定值、env、webhook payload、表單 |
| UI | Tailwind CSS + shadcn/ui | | 後台快速成形；大螢幕動畫用 CSS 或 `motion` |
| 測試 | Vitest（單元與整合，搭配 PGlite）、Playwright（後台 E2E） | | |
| 品質 | ESLint、`tsc --noEmit`、GitHub Actions CI | | |
| 套件管理 | pnpm | | |

### 2.1 考慮過但沒選的方案
| 方案 | 不選的原因 |
|---|---|
| Cloudflare Workers + OpenNext + D1/R2 | 完全免費而且允許商用，但 Next.js 16 透過 OpenNext adapter 有相容性風險（Node API、`after()` 行為），交給 Sonnet 實作的除錯成本比較高。**列為備案**：如果公司不願意付 Vercel Pro，就改走這條 |
| Supabase（DB + Storage） | 免費專案閒置 7 天會暫停，活動前後可能被暫停，需要額外做 keep-alive |
| Prisma | 可行，但 Drizzle 搭配 PGlite 做測試更簡單，在 serverless 環境也更輕 |
| LIFF 網頁上傳 | 體驗比較好（可以預覽、選景點），但多一個前端和 LIFF app 設定；聊天室流程已經夠用 |
| Firebase | 不是關聯式資料庫，抽獎和稽核查詢比較不方便 |

## 3. LINE Messaging API 重點（依官方文件整理）

| 主題 | 重點 | 對本系統的影響 |
|---|---|---|
| 建立頻道 | 官方文件：已經**不能**直接在 Developers Console 建立 Messaging API channel，必須先建立 LINE 官方帳號，再到 **LINE Official Account Manager** 啟用 Messaging API，並選擇 Provider | David 申請 OA 後要啟用 Messaging API，並選定 Provider（之後**不能更換**） |
| userId | 同一位使用者在**不同 Provider** 底下的 userId 不同 | 正式和測試 OA 放在同一個 Provider 下，測試人員的 userId 會一致，比較好除錯（兩個環境的資料庫仍然分開） |
| 簽章 | Header `x-line-signature`，用 channel secret 對**原始 body** 做 HMAC-SHA256，再 Base64 編碼。不可以先 parse 再序列化 | Route Handler 先用 `await req.text()` 驗簽，再 parse |
| Webhook 重送 | 預設關閉；開啟後，非 2xx 回應會被重送，但不保證送達，順序也可能不同。用 `webhookEventId` 去重，`deliveryContext.isRedelivery` 標示重送 | **開啟重送**，並用 `webhook_events` 去重 |
| 取得照片 | `GET https://api-data.line.me/v2/bot/message/{messageId}/content`；使用者傳的內容一段時間後會自動刪除 | 收到 webhook 就立即下載保存 |
| 多張照片 | 一次傳多張時，每張都是獨立事件，帶相同的 `imageSet.id` | 選景點時整組套用 |
| 回覆方式 | Reply（需要 replyToken、只能用一次、有時效）、Push、Multicast、Narrowcast、Broadcast；每個請求最多 5 個 message object | 互動全部用 reply；只有中獎通知用 push |
| 訊息計費 | **Reply 不計入**每月訊息額度。其他方式依「請求數 × 收件人數」計算；封鎖者和不存在的 userId 不計 | 見下方額度預算 |
| Retry key | Push 和 multicast 可以帶 `X-Line-Retry-Key`（UUID）；同一把 key 重送會回 409，代表已經接受 | 每則 push 都存 retry key |
| 額度查詢 | `GET /v2/bot/message/quota`、`GET /v2/bot/message/quota/consumption` | 顯示在後台儀表板 |
| Loading 動畫 | `POST /v2/bot/chat/loading/start`（1 對 1 聊天）| 照片處理中可以顯示「輸入中」動畫（選用） |
| Rate limit | 大部分端點為 2,000 req/s，loading 動畫為 100 req/s | 本活動遠低於上限 |
| Quick Reply | 最多 13 個按鈕；支援 postback、camera、cameraRoll | 景點選單、相機、相簿 |
| Channel access token | 有長期、短期、v2.1（JWT 簽發，可以指定效期）、stateless 等類型 | MVP 用**長期 token**（從 Console 發行並放進 Vercel env）；若要更嚴格，再改用 v2.1 |

### 3.1 訊息額度預算
台灣 OA 方案（依第三方資料，**申請時請到官方頁面確認**）：輕用量免費，每月 200 則；中用量 NT$800，每月 3,000 則；高用量 NT$1,200，每月 6,000 則。

| 用途 | 方式 | 估計則數 |
|---|---|---|
| 所有互動回覆（報名、上傳確認、進度、說明） | reply | 0（不計） |
| 中獎通知 | push × 得獎人數 | 約 10–40 |
| 重抽或補送 | push | 約 5 |
| （選用）得獎名單通知全部人 | multicast × 40 | 40 |
| （選用）人工審核通過通知 | push × 照片數 | **可能 200 以上，會爆額度**，預設關閉 |
| 測試 | 用測試 OA，不佔正式額度 | — |

結論：只要維持預設設定，**輕用量免費方案就夠用**。

## 4. 部署

### 4.1 環境
| 環境 | LINE 頻道 | Vercel | DB | Blob |
|---|---|---|---|---|
| local | 測試 OA（webhook 透過 tunnel 連到本機） | `pnpm dev` | 本機 Postgres 或 Neon dev branch；測試用 PGlite | 測試 store |
| preview / staging | **測試 OA**「EUCAN 抽獎測試」 | Preview（固定的 `staging` 分支網域） | Neon `staging` branch | 測試 store |
| production | **正式 OA**（David 申請） | Production（`main`） | Neon `main` branch | 正式 store |

- 每個 LINE 頻道只能設定**一個** webhook URL，所以 staging 必須用**固定網址**：在 Vercel 為 `staging` 分支設定固定網域（例如 `staging-<project>.vercel.app`），不能用每次部署都會變的 preview URL。
- **Vercel Deployment Protection**：Preview 預設需要 Vercel 登入，LINE 會打不進來。可以對 staging 關閉保護，或設定 Protection Bypass（將 bypass token 放在 webhook URL query，這個 token 也算機密，不得寫入 repo）。
- 本機開發：用 `cloudflared tunnel` 或 `ngrok` 把 `localhost:3000` 暴露出去，再把測試 OA 的 webhook URL 暫時指向 tunnel。
- 環境變數全部放在 Vercel Project Settings（依環境區分），repo 只放 `.env.example`。

### 4.2 測試用 LINE 頻道
1. 用同一個 Provider（例如「EUCAN」）再建立一個 LINE 官方帳號「EUCAN 抽獎測試」（免費），在 OA Manager 啟用 Messaging API。
2. 到 OA Manager →「回應設定」：開啟 **Webhook**，關閉**自動回應訊息**和**加入好友的歡迎訊息**（由 Bot 自行處理）。
3. 到 Developers Console → Messaging API 分頁：設定 Webhook URL（指向 staging 或 tunnel）、開啟 Use webhook 和 Webhook redelivery、發行 channel access token。
4. 開發者和測試同仁加測試 OA 好友。
5. 正式 OA 也照上述步驟設定，但 webhook 指向 production，而且在活動前一週再公布 QR code。

### 4.3 費用與方案
| 項目 | 方案 | 預估費用 |
|---|---|---|
| Vercel | Hobby 免費，但官方 fair-use 規定**限個人非商業用途**。公司內部活動屬於灰色地帶，**建議活動期間（12 月到 1 月）升級 Pro**，每月 US$20，或改走 Cloudflare 備案（見 open-questions） | US$0–40 |
| Neon | Free（0.5 GB、閒置時 scale-to-zero，冷啟動約數百毫秒） | US$0 |
| Vercel Blob | 免費額度內 | US$0 |
| LINE OA | 輕用量（每月 200 則） | NT$0 |
| 網域 | 用 `*.vercel.app` 即可；要自訂網域才需要另外購買 | 0 |

### 4.4 活動當天的韌性
- Neon scale-to-zero 的冷啟動會讓第一個請求多花約 0.5 秒，webhook 仍然可以在 1 秒內回應。如果擔心，活動當天可以在 Neon 暫時關閉 autosuspend（免費方案若不支援，就用 Vercel Cron 每 5 分鐘 ping 一次。注意 Hobby 的 Cron 一天只能跑一次，所以這也是升級 Pro 的理由之一）。
- `draw.scheduledAt` 自動開抽依賴 Cron。Hobby 的 Cron 精度是小時級，所以**現場抽獎一律由管理員手動觸發**。
- LINE webhook 重送和 `webhook_events` 去重，可以涵蓋短暫錯誤。後台提供「重跑失敗事件」。
- 景點如果收訊不好，使用者之後再傳照片也可以；照片的計算以**上傳時間**為準，`upload.deadlineAt` 要預留緩衝。

## 5. 專案結構（建議）

```text
src/
  app/
    api/line/webhook/route.ts      # 驗簽 + 去重 + after()
    api/admin/photos/[id]/route.ts # 受保護的照片串流
    api/cron/*/route.ts            # 選用
    admin/(protected)/...          # 後台頁面
    admin/login/page.tsx
  lib/
    line/        client.ts, signature.ts, messages.ts (Flex/QuickReply builders), handlers/*.ts
    domain/      entitlements.ts (純函式), draw.ts (純函式 + RNG 注入), submissions.ts
    db/          schema.ts, client.ts, queries/*.ts
    settings/    schema.ts (zod + 預設值), service.ts
    storage/     index.ts (介面), vercel-blob.ts, memory.ts (測試用)
    auth/        session.ts
  env.ts         # zod 驗證 env
drizzle/         # migrations
scripts/
  fake-webhook.ts   # 用測試 secret 簽章並送出假事件到本機或 staging
  rich-menu.ts      # 建立並上傳圖文選單
  seed.ts
tests/
  unit/ integration/ e2e/
```

## 6. 測試策略
| 層級 | 工具 | 內容 |
|---|---|---|
| 單元 | Vitest | `computeEntitlements` 三種模式與邊界條件；`draw` 使用可注入的 RNG 進行決定性測試（含不足額、重抽、不可重複中獎）；簽章驗證；設定 schema |
| 整合 | Vitest + PGlite + mock LINE client | 以簽章正確的 payload 呼叫 webhook route，驗證 DB 狀態、去重、兩種上傳順序、imageSet |
| E2E | Playwright | 後台登入 → 建立景點與獎品 → 審核 → 抽獎 → 通知（LINE client 以 mock 取代） |
| 手動驗收 | 測試 OA | 實機加好友、傳照片、查進度、抽獎、收通知 |
| 壓力驗證 | `scripts/fake-webhook.ts` | 對 staging 模擬 40 人 × 10 張照片，在 2 分鐘內送完，確認沒有錯誤也沒有重複 |
