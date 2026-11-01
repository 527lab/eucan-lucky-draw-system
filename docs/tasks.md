# 實作任務拆解（tasks.md）

> 對象：由 Sonnet 依序實作。每個階段（S1–S8）各開一個分支、一個 PR，合併後再進行下一階段。
> 規格以 [spec.md](./spec.md)、[architecture.md](./architecture.md) 為準；遇到未定事項，依 [open-questions.md](./open-questions.md) 的「預設做法」，不要自行發明規則。

## 共通規則（每個階段都適用）

1. **不得提交任何金鑰**（channel secret、access token、DB URL、密碼、bypass token）。只能更新 `.env.example` 的**鍵名**。PR 前執行 `git grep -nE "(secret|token|password)\s*[:=]\s*['\"][^'\"]{8,}"` 自我檢查。
2. 分支命名 `s<N>-<slug>`，PR 標題 `S<N>: <摘要>`，PR 內文用中文，列出驗收條件的勾選結果。
3. 每個 PR 都必須通過 CI：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`。
4. TypeScript `strict: true`，禁止使用 `any`（真的需要時用 `unknown` 再收窄）。
5. 呼叫 LINE API 一律經過 `src/lib/line/client.ts` 的包裝（方便 mock）。測試**不得**打到真實的 LINE API。
6. 業務邏輯（資格計算、抽獎）是**純函式**，不得直接讀 DB 或取得時間、亂數；這些都要由參數注入。
7. 不確定的地方在 PR 內文的「待確認」區塊列出，不要擅自擴大範圍。

---

## S1 專案骨架與 CI
**內容**
- `create-next-app`：Next.js 16.x（App Router、TypeScript、Tailwind、ESLint、`src/` 目錄），使用 pnpm。
- 加入 Vitest、Playwright（只放設定與一個 smoke test）。
- `src/env.ts`：用 zod 驗證 [spec.md §7.1](./spec.md#71-環境變數只列名稱) 的所有 env；`APP_ENV=test` 時允許缺值。
- `.env.example`：只列鍵名與說明註解。
- GitHub Actions：lint、typecheck、test、build（build 時用假的 env 值，寫在 workflow 中、明確標為 dummy）。
- `README.md`：本機啟動步驟。

**驗收條件**
- [ ] `pnpm i && pnpm dev` 可以啟動，首頁顯示活動名稱
- [ ] `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全部通過，CI 綠燈
- [ ] 缺少必要 env 時，啟動會出現清楚的錯誤訊息（列出缺少的鍵）
- [ ] repo 中沒有任何真實金鑰

## S2 資料庫結構與設定模組
**內容**
- Drizzle schema：依 [spec.md §6](./spec.md#6-資料模型) 建立全部的表、enum、索引、partial unique index（`draw_runs`）。
- drizzle-kit migrations；`pnpm db:migrate`、`pnpm db:seed`（建立 3 個範例景點、3 個範例獎品）。
- `src/lib/db/client.ts`：正式環境用 Neon serverless driver，測試用 PGlite，由 env 決定。
- `src/lib/settings/`：zod schema（[spec.md §7.2](./spec.md#72-業務設定settings-表)）加上預設值；`getSettings()` 會把 DB 值合併到預設值上，`updateSetting(key, value, actor)` 會驗證並寫入稽核紀錄。抽獎鎖定時，修改 `ticket.*`、`review.mode` 會拋出錯誤。
- 測試 helper：每個測試建立一個全新的 PGlite 並跑 migration。

**驗收條件**
- [ ] migration 可以在空的 Postgres 和 PGlite 上執行成功
- [ ] `getSettings()` 在 DB 沒有資料時回傳完整的預設值；寫入不合法的值（例如 `ticket.mode = "foo"`）會被拒絕
- [ ] 存在 `locked` 的 draw_run 時，修改 `ticket.mode` 會失敗；取消後就可以修改
- [ ] `submissions.line_message_id`、`webhook_events.webhook_event_id` 的唯一性約束有測試覆蓋

## S3 LINE Webhook 基礎
**內容**
- `src/lib/line/signature.ts`：HMAC-SHA256 + Base64，使用 `crypto.timingSafeEqual`。
- `POST /api/line/webhook`（`runtime = 'nodejs'`）：讀 raw body → 驗簽 → 寫入 `webhook_events`（ON CONFLICT DO NOTHING）→ 回 200 → 在 `after()` 中分派 handler。
- Handlers：`follow`（建立或恢復參加者，取得 profile，回覆歡迎訊息）、`unfollow`、`message.text`（報名流程 `awaiting_name`、`awaiting_join_code`，以及關鍵字「打卡」「進度」「說明」）、`postback` 路由骨架、群組事件（`leave`）。
- `src/lib/line/messages.ts`：Quick Reply 與文字訊息 builder，範本來自設定。
- `scripts/fake-webhook.ts`：讀取本機 env 的測試 secret，簽章後送出指定類型的事件（follow、text、image、postback）。

**驗收條件**
- [ ] 簽章錯誤時回 401，而且不寫入 DB
- [ ] 同一個 `webhookEventId` 送兩次，只處理一次（整合測試）
- [ ] `registration.mode` 三種模式的報名流程都有整合測試
- [ ] 用測試 OA 實機：加好友收到歡迎訊息、輸入姓名後完成報名、輸入「說明」收到說明文字
- [ ] webhook 回應時間（不含 `after()`）在本機量測 < 300ms

## S4 照片上傳流程
**內容**
- `src/lib/storage/`：介面加上 Vercel Blob 實作與 in-memory 實作（測試用）；key 格式 `photos/<participantId>/<uuid>.jpg`。
- `message.image` handler：先下載（`MessagingApiBlobClient.getMessageContent`）再上傳 storage，接著建立 submission，依 [spec.md §3.2](./spec.md#32-上傳景點合照核心流程) 的路徑 A 和 B 處理。
- 景點選單（Quick Reply 超過 13 個時改用 Flex carousel）、`awaiting_photo` 狀態與 TTL、`imageSet` 整組套用景點。
- 依審核模式決定 submission 狀態；處理截止時間、景點時段、`upload.maxPerSpotPerUser`、抽獎鎖定後拒收。
- 「進度」的 Flex Message。
- 可選用 loading 動畫 API。

**驗收條件**
- [ ] 路徑 A（先選景點再傳照片）與路徑 B（先傳照片再選景點）都有整合測試
- [ ] 一次傳 3 張（相同 `imageSet.id`），選一次景點後 3 張都綁定
- [ ] 超過截止時間、景點未開放、抽獎已鎖定時，都會回覆正確的提示，不會計入資格
- [ ] 同一張照片的事件重送不會產生第二筆 submission
- [ ] 下載或上傳失敗時，`webhook_events.status = failed` 而且有記錄 error
- [ ] 測試 OA 實機：完成 2 個景點後，「進度」顯示 2 個打勾

## S5 資格計算引擎
**內容**
- `src/lib/domain/entitlements.ts`：`computeEntitlements(settings, approvedSubmissions, spots, adjustments) → Map<participantId, {tickets, completedSpotIds, eligible}>`。
- 將 S4 中「目前 N 張券」的回覆改為使用這個函式。

**驗收條件**
- [ ] 三種模式 × 以下情境的單元測試全部通過：沒有照片、重複景點、`counts_for_ticket=false`、`required=false`、`maxPerUser` 上限、負的手動調整後歸零、封鎖者（依 `keepOnUnfollow`）、被停權者
- [ ] 函式沒有任何 I/O（以 lint 規則或 code review 確認）
- [ ] 測試覆蓋率 ≥ 95%（此檔案）

## S6 管理後台
**內容**
- 登入、登出、session middleware，以及登入失敗速率限制。
- [spec.md §4.2](./spec.md#42-頁面) 中除了抽獎以外的所有頁面：儀表板（含 LINE 額度查詢）、景點、參加者、照片審核（批次操作）、獎品、設定、訊息範本、稽核紀錄。
- `/api/admin/photos/[id]`：驗證 session 後串流 Blob 照片，回應帶 `Cache-Control: private`。
- 手動新增 submission（給系統故障時人工補登使用）。
- 所有寫入都寫進 `admin_audit_logs`。

**驗收條件**
- [ ] 未登入存取任何 `/admin/**` 或 `/api/admin/**` 都會被導向登入頁或回 401（E2E 測試）
- [ ] 審核頁可以篩選、批次通過或退件，退件後該使用者的券數立即重新計算
- [ ] 修改 `ticket.mode` 後，儀表板和使用者「進度」的券數跟著改變
- [ ] Playwright E2E：登入 → 建立景點 → 建立獎品 → 審核照片，流程全綠
- [ ] 手機寬度（375px）下，審核頁仍然可以操作

## S7 抽獎與通知
**內容**
- `src/lib/domain/draw.ts`：`runDraw(pool, prizes, settings, rng) → results`，純函式，RNG 可注入。
- 後台抽獎頁：預覽獎池（每人券數與機率）→ 鎖定（建立 snapshot）→ 開抽 → 結果列表 → 單一名額重抽（void 後補抽）→ 取消本次抽獎。
- `/admin/draw/live`：全螢幕逐項揭曉（依 `draw_results` 順序，按下「下一個」設定 `revealed_at`），重新整理後保留進度。
- 中獎通知：逐筆 push，帶 `X-Line-Retry-Key`，寫入 `outbound_messages`；遇到 409 視為成功；可以單筆重送。選用的 `announceToAll` 使用 multicast。
- 匯出 CSV（得獎名單、全部參加者與券數）。

**驗收條件**
- [ ] 以固定種子的 RNG 進行單元測試：結果可以重現；`allowMultipleWins=false` 時沒有人重複中獎；人數不足時產生 `unfilled`
- [ ] 統計測試：10,000 次模擬中，券數 2:1 的兩人中獎比例落在 2±0.15 之間
- [ ] 鎖定後新上傳的照片不影響獎池；取消後可以重新鎖定
- [ ] 重抽不會抽到已經得獎或已被 void 的人（依設定）
- [ ] 同一筆 result 重複按「發送通知」只會送出一次（retry key 測試）
- [ ] 測試 OA 實機：3 人參加、2 個獎品，得獎者收到通知，大螢幕揭曉正常

## S8 部署、圖文選單、彩排
**內容**
- `scripts/rich-menu.ts`：用 API 建立圖文選單（上傳打卡照、我的進度、活動說明），上傳圖片並設為預設選單；可以指定環境。
- Vercel 專案設定文件（`docs/runbook.md`）：env 對照表（只寫鍵名）、Neon 與 Blob 整合步驟、staging 固定網域、Deployment Protection bypass、LINE Console 設定步驟、活動當天檢查表、故障應變（人工補登、重跑失敗事件）。
- Vercel Cron（選用）：照片保存期滿後刪除、DB keep-alive。
- 壓力驗證：用 `fake-webhook.ts` 對 staging 模擬 40 人 × 10 張照片。

**驗收條件**
- [ ] staging（測試 OA）與 production（正式 OA）都可以正常收發
- [ ] 壓力驗證：400 個 image 事件在 2 分鐘內送完，0 個失敗，submissions 筆數正確，沒有重複
- [ ] runbook 中的活動當天檢查表經過一次完整彩排（含抽獎與通知）
- [ ] 正式 OA 的 webhook「Verify」按鈕成功；自動回應訊息已關閉
- [ ] 正式 DB 已清除彩排資料（或彩排使用 staging）

---

## 時程建議
| 週次 | 階段 |
|---|---|
| 11/2–11/15 | S1–S3 |
| 11/16–11/29 | S4–S5 |
| 11/30–12/13 | S6–S7 |
| 12/14–12/20 | S8、正式 OA 設定 |
| 12/21–12/27 | 彩排與修正 |
| 2027/1 月初 | 活動 |
