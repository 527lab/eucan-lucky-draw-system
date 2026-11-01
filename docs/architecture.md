# 架構與技術選型（architecture.md）

> 版本：S0c（2026-11-01，依 David 決定修訂：自架 Docker + Cloudflare Tunnel；僅員工參加；員工身分只憑員工編號、向請假系統查證；/admin 加 Cloudflare Access）。版本號是撰寫當下 npm 上的最新版，實作時以 `npm view <pkg> version` 為準。

## 1. 架構總覽

```text
 員工手機 (LINE App)
      │  傳照片 / 點選單
      ▼
 LINE Platform ──webhook (HTTPS POST, x-line-signature)──▶ Cloudflare 邊緣（網域 DNS 在 Cloudflare）
      ▲                                                          │  Cloudflare Tunnel（cloudflared 主動對外連線，家中不開 port）
      │ reply / push (api.line.me)                               ▼
      │ get content (api-data.line.me)             ┌── David 家用伺服器（Docker Compose）──────────────┐
      │                                            │  cloudflared ─▶ app (Next.js standalone, :3000)   │
      └────────────────────────────────────────────┤                 ├─ /api/line/webhook             │
                                                   │                 ├─ /admin/**                     │
                                                   │                 └─ /api/admin/photos/[id]        │
                                                   │  db (postgres:17)        ← volume: pgdata        │
                                                   │  photos（本機檔案）       ← volume: photos        │
                                                   │  backup（每日 pg_dump + 照片同步）               │
                                                   └──────────────────────────────────────────────────┘
                                                              ▲ 員工編號查證（本系統主動呼叫，只回 是/否）
                                                              │
                                                   EUCAN 請假系統（527lab/eucan-leave-next）
```

Webhook 處理時序：

```text
POST /api/line/webhook
  1. 讀 raw body（req.text()），用 LINE_CHANNEL_SECRET 做 HMAC-SHA256，與 x-line-signature 做 timing-safe 比對 → 不符就回 401
  2. JSON.parse → 每個 event 以 webhookEventId INSERT ... ON CONFLICT DO NOTHING 寫入 webhook_events
  3. 回 200（目標 < 1 秒）
  4. after(() => 依序處理新插入的 events)
       - follow / unfollow / message.text / message.image / postback
       - image：GET content → 寫入照片 volume → 建 submission → reply
       - 失敗：webhook_events.status = failed，記錄 error，後台可以重跑
```

> 回 200 之後才處理，是因為 LINE 官方建議「非同步處理事件」，而且下載照片可能需要幾秒。自架 Node 長駐行程（standalone）中，`after()` 會在回應送出後繼續執行，不會像 serverless 被凍結；但行程若在處理中被重啟，事件會停在 `received` 狀態，所以啟動時與每分鐘有一個**補償掃描**，重跑超過 30 秒仍未完成的事件（事件已持久化，處理邏輯為冪等）。
> Reply token 有時效而且只能用一次（官方錯誤碼包含 expired 和 used reply token），所以背景處理要**先回覆、再做非必要的工作**。如果 reply 失敗而且屬於 token 過期，就改用 push 補送，但只限重要訊息，避免用掉額度。

## 2. 技術選型與理由

| 層 | 選擇 | 版本（2026-11） | 理由 |
|---|---|---|---|
| 框架 | **Next.js（App Router）+ TypeScript strict** | next 16.4.x | 依需求優先。webhook 和後台放在同一個專案、一次部署；Server Actions 讓後台 CRUD 很省事。與請假系統（Next.js）同棧 |
| 執行環境 | Node.js 22 LTS（Docker 映像 `node:22-alpine`，`output: 'standalone'`） | | `@line/bot-sdk` 和 `crypto` 需要 Node runtime；standalone 讓映像小、啟動快 |
| LINE SDK | **`@line/bot-sdk`**（官方） | 11.4.x | 官方維護，有 TypeScript 型別、`validateSignature`、`messagingApi.MessagingApiClient` 和 `MessagingApiBlobClient`（get content） |
| 資料庫 | **PostgreSQL 17（Docker 容器，資料在具名 volume）** | | 自架、無容量與休眠限制。用 `pg` driver 走 compose 內部網路 |
| ORM | **Drizzle ORM + drizzle-kit** | 0.45.x | 輕量、SQL 透明。測試可以用 PGlite（in-process Postgres），CI 不需要 Docker |
| 照片儲存 | **本機檔案系統（Docker volume `photos`）** | | 40 人 × 10 張 × 約 0.5 MB ≈ 200 MB。以隨機 key 存放、不對外公開，由後台路由代理讀取。程式只依賴 `storage` 介面，之後要換 S3 / Cloudflare R2 只要新增一個實作 |
| 部署 | **Docker Compose：`app` + `db` + `cloudflared` + `backup`** | | 見 §4 |
| 對外連線 | **Cloudflare Tunnel（`cloudflared`）** | | 家用網路沒有固定 IP、不必開 port、自動 HTTPS，網域本來就在 Cloudflare |
| 驗證 | 自製密碼 + 簽章 cookie（`jose` 或 `iron-session`） | | 管理員 2–3 人，不需要 OAuth。後台前面另有 Cloudflare Access 當第一道門（§4.4） |
| 驗證資料 | `zod` | | 設定值、env、webhook payload、表單 |
| UI | Tailwind CSS + shadcn/ui | | 後台快速成形；大螢幕動畫用 CSS 或 `motion` |
| 排程 | 容器內排程（app 行程內 `node-cron`，或獨立 cron 容器呼叫帶 `CRON_SECRET` 的端點） | | 精度到分鐘；自動開抽、補償掃描、名單同步、照片到期清理都用它 |
| 測試 | Vitest（單元與整合，搭配 PGlite）、Playwright（後台 E2E） | | |
| 品質 | ESLint、`tsc --noEmit`、GitHub Actions CI（含 `docker build` 驗證） | | |
| 套件管理 | pnpm | | |

### 2.1 考慮過但沒選的方案
| 方案 | 不選的原因 |
|---|---|
| Vercel + Neon + Blob | S0 原案。Hobby 限非商業用途、需考慮升級 Pro；David 決定改自架（成本 0、資料自己掌握） |
| Cloudflare Workers + OpenNext + D1/R2 | Next.js 16 透過 OpenNext adapter 有相容性風險；既然已有家用伺服器就不需要 |
| Supabase（DB + Storage） | 免費專案閒置會暫停；自架 Postgres 沒有這個問題 |
| Prisma | 可行，但 Drizzle 搭配 PGlite 做測試更簡單 |
| LIFF 網頁上傳 | 體驗較好，但多一個前端和 LIFF app 設定；聊天室流程已經夠用 |
| 開 router port + DDNS | 暴露家中 IP、要自己處理 TLS 與攻擊面；Tunnel 較安全 |

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
| Channel access token | 有長期、短期、v2.1（JWT 簽發，可以指定效期）、stateless 等類型 | MVP 用**長期 token**（從 Console 發行並放進伺服器 `.env`）；若要更嚴格，再改用 v2.1 |

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

## 4. 部署（自架 Docker + Cloudflare Tunnel）

### 4.1 Compose 服務
| 服務 | 映像 | 說明 |
|---|---|---|
| `app` | 自建（`Dockerfile`，multi-stage、standalone、非 root 使用者） | 只在 compose 內部網路監聽 `:3000`，**不對 host 發布 port**；`/api/health` 供 healthcheck |
| `db` | `postgres:17-alpine` | volume `pgdata`；不對 host 發布 port（本機除錯時才綁 `127.0.0.1`） |
| `cloudflared` | `cloudflare/cloudflared` | `tunnel run`，token 由 env `TUNNEL_TOKEN` 提供；ingress 在 Cloudflare Zero Trust 後台設定（remotely-managed tunnel）：`lucky.<網域>` → `http://app:3000` |
| `backup` | 自建小映像（`pg_dump` + cron） | 每日 `pg_dump` 壓縮到 `./backups/`，並同步照片 volume 到另一顆硬碟或雲端；保留 14 天 |

啟動順序：`db` healthy → `app`（啟動時自動 migrate）→ `cloudflared`。所有服務 `restart: unless-stopped`，伺服器重開機後自動恢復。

### 4.2 環境
| 環境 | LINE 頻道 | 網域 | Compose 專案 | DB / 照片 |
|---|---|---|---|---|
| local | 測試 OA（webhook 透過臨時 tunnel `cloudflared tunnel --url http://localhost:3000` 連到本機） | 臨時 `*.trycloudflare.com` | `pnpm dev` + 本機 Postgres 容器；測試用 PGlite | 本機 |
| staging | **測試 OA**「EUCAN 抽獎測試」 | `lucky-staging.<網域>`（固定） | 同一台伺服器上的獨立 compose 專案 `luckydraw-staging` | 獨立 volume |
| production | **正式 OA** | `lucky.<網域>`（固定） | compose 專案 `luckydraw-prod` | 獨立 volume |

- 每個 LINE 頻道只能設定**一個** webhook URL，所以 staging、production 各用一個固定主機名稱，建議各一條 Tunnel，避免誤操作互相影響。
- 環境變數放在伺服器上的 `.env`（權限 600，不進版控），repo 只放 `.env.example`；`TUNNEL_TOKEN`、`LINE_*`、`DATABASE_URL`、`LEAVE_API_TOKEN` 都屬機密。
- **LINE 官方帳號與 Provider 名稱暫緩**（見 open-questions D 區）。開發初期只用 `fake-webhook` 腳本與整合測試，不依賴真實頻道。

### 4.3 部署與更新流程
1. GitHub Actions 通過後，在 `main` 打版本標籤並將映像推到 GHCR（私人，`ghcr.io/527lab/eucan-lucky-draw-system`）。
2. 伺服器上 `docker compose pull && docker compose up -d`（MVP 手動即可，之後可加 `deploy.sh`）。
3. migration 在 `app` 啟動時執行；有破壞性變更前先手動備份。
4. 回滾：把映像 tag 改回前一版再 `up -d`；DB 需要時從備份還原。

### 4.4 Cloudflare 設定要點
- **DNS / Tunnel**：Zero Trust → Networks → Tunnels 建立 tunnel 取得 token；Public Hostname 指向 `http://app:3000`。
- **後台由 Cloudflare Access 保護（已決定）**：在 Zero Trust → Access → Applications 建立 *Self-hosted application*，主機 `lucky.<網域>`（staging 同理），**Path 只列 `/admin*` 與 `/api/admin*`**（後者含受保護的照片路由）。Policy：Action = Allow，Include = 管理員 email 清單（登入方式用 One-time PIN 即可，不必設定 IdP）；Session duration 設 24 小時，讓現場大螢幕不會在抽獎中途過期。
- **不套用 Access 的路徑**：`/api/line/webhook`（LINE 伺服器無法登入；由 `x-line-signature` 保護）、`/api/health`、`/api/cron/*`（由 `CRON_SECRET` 保護，且排程可改走容器內部呼叫）。**不要**用「整站 Access + bypass」的寫法，避免日後新路由預設暴露或被誤擋；以路徑白名單套用 Access。
- **應用層再驗一次 Access JWT**：Access 通過後會在請求帶 `Cf-Access-Jwt-Assertion`。app 的 middleware 對 `/admin*`、`/api/admin*` 用 `jose` 依 `https://<CF_ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs` 的 JWKS 驗證簽章、`aud`＝`CF_ACCESS_AUD`、效期；失敗回 403。這能防止有人繞過 Cloudflare 直接打到容器（例如 Access 設定被誤改、路徑漏列）。JWT 內的 email 寫入 `admin_audit_logs.actor`。管理密碼（§2）保留為第二層。
- **驗證方式**：部署後以未登入狀態 `curl -I https://lucky.<網域>/admin` 應被導向 Access 登入；`curl -I https://lucky.<網域>/api/line/webhook` 不得被導向（LINE Console 的 Verify 按鈕要成功）。
- **WAF / Bot Fight Mode**：可能誤擋 LINE webhook，對 `/api/line/webhook` 加一條 skip 規則。LINE 有公布來源 IP 清單，但會變動，**不要寫死**，僅作輔助；簽章驗證才是主要防線。
- **Webhook 回應時間**：Tunnel 多一跳約數十毫秒，遠低於 1 秒目標。照片是系統主動從 LINE 下載，不受 Cloudflare 上傳大小限制影響。
- **Rate limit**：對 `/admin/login` 加 Rate limiting rule，應用層也限制嘗試次數。

### 4.5 測試用 LINE 頻道（暫緩，待 David 申請 OA 後執行）
1. 用同一個 Provider 再建立一個 LINE 官方帳號「EUCAN 抽獎測試」（免費），在 OA Manager 啟用 Messaging API。**Provider 名稱尚未決定**。
2. 到 OA Manager →「回應設定」：開啟 **Webhook**，關閉**自動回應訊息**和**加入好友的歡迎訊息**（由 Bot 自行處理）。
3. 到 Developers Console → Messaging API 分頁：設定 Webhook URL（staging 或臨時 tunnel）、開啟 Use webhook 和 Webhook redelivery、發行 channel access token。
4. 開發者和測試同仁加測試 OA 好友。
5. 正式 OA 也照上述步驟設定，但 webhook 指向 production，而且在活動前一週再公布 QR code。

### 4.6 費用
| 項目 | 預估費用 |
|---|---|
| 伺服器與電力 | David 既有設備，0 |
| Cloudflare（DNS、Tunnel、Access 50 人內） | 0（網域費用已有） |
| GHCR 私人映像 | 0（在 GitHub 方案額度內） |
| LINE OA | 輕用量（每月 200 則）NT$0 |

### 4.7 活動當天的韌性（家用環境的風險）
| 風險 | 對策 |
|---|---|
| 停電 | 伺服器接 UPS，BIOS 設定「通電自動開機」；Compose 開機自動啟動 |
| 家用網路中斷 | 活動前一週與當天確認連線；備用：手機熱點接伺服器，或把 compose 搬到筆電，Tunnel token 換機器即可恢復（網址不變） |
| 單點故障 | 照片仍保存在 LINE 聊天室，可人工補登（後台有「手動新增 submission」）；LINE 對失敗的 webhook 會重送，`webhook_events` 去重 |
| 資料損毀 | 每日備份 + 活動前、抽獎前手動備份；事先演練一次還原 |
| `draw.scheduledAt` 自動開抽 | 依賴容器內排程；**現場抽獎仍一律由管理員手動觸發** |
| 時鐘漂移 | 伺服器啟用 NTP；`upload.deadlineAt` 以伺服器時間為準，預留緩衝 |
| 景點收訊不好 | 使用者之後再傳照片也可以；照片的計算以**上傳時間**為準 |

## 5. 專案結構（建議）

```text
src/
  app/
    api/line/webhook/route.ts      # 驗簽 + 去重 + after()
    api/admin/photos/[id]/route.ts # 受保護的照片串流
    api/health/route.ts
    api/cron/*/route.ts            # 受 CRON_SECRET 保護
    admin/(protected)/...          # 後台頁面（含員工編號備援清單、解除綁定）
    admin/login/page.tsx
  lib/
    line/        client.ts, signature.ts, messages.ts (Flex/QuickReply builders), handlers/*.ts
    domain/      entitlements.ts (純函式), draw.ts (純函式 + RNG 注入), submissions.ts
    db/          schema.ts, client.ts, queries/*.ts
    settings/    schema.ts (zod + 預設值), service.ts
    storage/     index.ts (介面), fs.ts (本機 volume), memory.ts (測試用)
    employees/   verifier.ts (EmployeeVerifier 介面), binding.ts, adapters/{csv,leave-api,mock}.ts
    auth/        session.ts, access-jwt.ts (驗證 Cloudflare Access JWT)
  env.ts         # zod 驗證 env
drizzle/         # migrations
deploy/
  Dockerfile, docker-compose.yml, .env.example, backup/
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

## 7. 員工身分查證（與請假系統聯動）

### 7.1 背景與決定
- 只有**在職員工**能參加，沒有眷屬。員工名單的**唯一真實來源**是 EUCAN 請假系統（現行 `527lab/eucan-new-server`，未來為 `527lab/eucan-leave-next`）。
- **David 決定（S0c）**：員工只要在 LINE 輸入**員工編號**即可參加，不做綁定碼流程。系統向請假系統**即時查證**編號是否存在且在職；請假系統**只需提供「編號是否有效」的查詢**，欄位最小化。
- 因此本系統**不保存員工主檔、不同步名單**（取消 S0b 的 `employees` 副本與 `employee_bind_codes`）。本系統只記錄「某個 LINE 帳號宣告了某個通過查證的員工編號」。
- 代價：看不到員工姓名，後台以 **LINE 暱稱 + 員工編號** 辨識參加者。若之後需要姓名（例如得獎公布），再請請假系統在查證回應多回 `name`（見 open-questions B5），資料模型只需加一欄。

### 7.2 查證介面：`EmployeeVerifier`
```ts
interface EmployeeVerifier {
  // 回傳 true 代表「編號存在且在職」；其他一律 false。不回傳任何個人資料。
  verify(employeeNo: string): Promise<{ valid: boolean }>;
}
```
| 轉接器 | 用途 | 狀態 |
|---|---|---|
| `leave-api` | 呼叫請假系統查證 API（§7.4）。含逾時（3 秒）、失敗時回覆「系統忙碌請稍後再試」，**不可**因 API 故障而放行 | 請假系統就緒後啟用 |
| `csv` | 管理員在後台上傳「員工編號清單」（單欄 CSV）存入 `employee_allowlist`，本地比對 | **MVP 預設**：不依賴請假系統即可上線，也是 API 故障時的備援（切換 `employees.source`） |
| `mock` | 測試用 | 必做 |

編號輸入先做正規化（trim、全形轉半形、大小寫統一）與格式檢查（長度、字元集，格式由設定決定），再送查證，避免把任意字串送到請假系統。

### 7.3 報名與防冒用
**流程**
1. `follow` → 建立 `participants`（`pending_registration`），Bot 請使用者輸入員工編號，並說明「一個員工編號只能綁定一個 LINE 帳號」。
2. 使用者傳送編號 → 正規化 → 檢查該 LINE 帳號是否被鎖定 → `verify()`。
3. 通過且編號**尚未被其他 LINE 帳號使用**：寫入 `participants.employee_no`（UNIQUE）與 `employee_verified_at`，狀態 `active`，回覆「✅ 已確認，歡迎參加」。
4. 編號無效：回覆通用訊息「查無此員工編號或非在職，請確認後再輸入」。
5. 編號**已被其他 LINE 帳號綁定**：回覆「此編號已被使用，若不是您本人操作，請聯絡福委 / HR」，並寫入 `employee_bind_attempts(result=already_bound)` 與稽核，後台參加者頁可看到。
6. 同一 LINE 帳號連續輸入失敗 `registration.maxFailures`（預設 5）次，鎖定 `registration.lockMinutes`（預設 15）分鐘。這同時防止有人用腳本枚舉員工編號。

**風險與最輕量緩解**

| 風險 | 緩解（皆為輕量） | 殘餘風險 |
|---|---|---|
| 冒用他人編號報名 | ① 一編號一 LINE 帳號（DB UNIQUE，先到先綁）；② 失敗鎖定防枚舉；③ 後台列表顯示 LINE 暱稱 + 編號，管理員一眼可看出暱稱與編號不符；④ 稽核紀錄 | 知道他人編號的同事若搶先綁定就能參加 |
| 本人被搶先綁定而無法報名 | Bot 提示聯絡 HR；管理員於後台「解除綁定」後，本人重新報名即可；被解除者狀態改為 `pending_registration`，其照片與券一併作廢（可選保留，由管理員決定） | 需要人工處理 |
| 換手機 / 新 LINE 帳號 | 同上，管理員解除綁定後重新綁定 | 同上 |
| 冒用者中獎 | 得獎通知只會到冒用者的 LINE；**領獎現場核對員工證**（後台中獎名單顯示員工編號供核對）；不符則 `void` 重抽 | 靠現場把關 |
| 外部人士拿到編號 | 員工編號本身不算機密，無法完全避免；活動 QR code 只在內部公布，並可啟用 `registration.joinCode`（活動通關碼）作額外一關 | 屬公司內部管理問題 |

> 說明：員工編號不是密碼，這個模式的安全性等於「知道編號 + 搶先綁定」。以 30–40 人的內部旅遊，這個風險可接受，並以「管理員可解除」與「領獎核對員工證」兜底。若 David 之後覺得不夠，可在 `registration.joinCode` 之外再加一道（例如要求同時輸入生日月日），只需改 handler，不動資料模型。

**未通過查證者**不能上傳照片、也不進入獎池；上傳時 Bot 提示先完成報名。

### 7.4 請假系統需提供的 API（待與請假系統對齊）
本系統**主動呼叫**（pull）：請假系統不需要知道本系統的位置，家用伺服器只出不進。

```text
GET {LEAVE_API_BASE_URL}/api/integrations/employees/{employeeNo}/status
Authorization: Bearer <LEAVE_API_TOKEN>        # 專用、唯讀、可隨時作廢
→ 200 { "valid": true }     # 編號存在且在職
→ 200 { "valid": false }    # 不存在或已離職（兩者不區分）
```
- **回應只有一個布林值**，不含姓名、部門、email；「不存在」與「離職」不區分，避免洩漏人事資訊。
- 請假系統端建議：此 token 只能呼叫這支、加速率限制（例如每分鐘 60 次），並不要在 log 記錄完整編號。
- 若請假系統在公司內網或另一台主機：由它那邊再開一條 Cloudflare Tunnel，以 Cloudflare Access service token 保護；本系統只做 HTTPS 連出。
- 反向（請假系統推送）與共用資料庫**不採用**：避免外部寫入本系統、避免耦合對方 schema（現行為 SQLite，且將重構為 Next.js）。
- 「是否參加旅遊」不在查證範圍：凡在職員工皆可參加（B1）；若需排除，用 `csv` 模式的清單或管理員停權。

### 7.5 資料模型變更（摘要，詳見 spec §6）
- `participants`：新增 `employee_no`（UNIQUE，可為 NULL）、`employee_verified_at`。
- 新增 `employee_allowlist`（只有 `employee_no`，`csv` 模式用）、`employee_bind_attempts`（失敗鎖定與冒用稽核）。
- **移除** S0b 的 `employees`、`employee_bind_codes`。
- 設定：`registration.mode = employee`（預設）、`employees.source`（`csv`｜`leave-api`）、`registration.maxFailures`、`registration.lockMinutes`。
- 環境變數：`LEAVE_API_BASE_URL`、`LEAVE_API_TOKEN`（`leave-api` 時才需要）、`CF_ACCESS_TEAM_DOMAIN`、`CF_ACCESS_AUD`。

### 7.6 隱私與資料最小化
- 只保存員工編號（以及 LINE 暱稱、照片）；不保存姓名、部門、email。
- 活動結束後依 `privacy.purgeAfterDays` 一併清除 `employee_no`、`employee_allowlist`、`employee_bind_attempts`。
- `employee_bind_attempts` 只存編號雜湊。
