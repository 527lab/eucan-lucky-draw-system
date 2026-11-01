# S6 交接（第一刀：後台登入核心，無 UI）

## 做了什麼
tasks.md 的 S6（管理後台）很大，這次只做其中「規格已明定、不需 David 決定、純邏輯可測」的登入核心，放在 `src/lib/auth/`：
- `admin-authenticator.ts`：`AdminAuthenticator` 介面、`AuthUnavailableError`；轉接器 `leave-api`（POST `/api/integrations/auth/verify`，5 秒逾時，`ok && isManager` 才放行；逾時／5xx／非 200／非 JSON／欄位缺漏一律 `AuthUnavailableError`，錯誤不帶 cause、不含密碼）、`mock`（production 直接拒絕建立）；`loginAdmin()` 協調主要驗證與緊急備援，回 `ok | invalid | unavailable`。
- `password-hash.ts`：備援密碼 scrypt 雜湊（`scrypt$salt$hash`），`timingSafeEqual`，格式錯誤一律不放行。`scripts/hash-password.ts` 從 stdin 讀密碼輸出雜湊。
- `session.ts`：HMAC-SHA256 簽章 cookie 值、24 小時、時間注入；`formatActor`（「員工編號 姓名」，備援為 `break-glass`）。
- `rate-limit.ts`：`LoginRateLimiter`（預設同 key 每分鐘 5 次失敗，之後 `check` 回 retryAfter → 呼叫端回 429）。
- `audit.ts`：`writeAdminAudit`、`auditLogin`（備援登入寫 `auth.login.break-glass`）。
- `auth.test.ts`：27 項（含本機 mock HTTP server 測 leave-api、PGlite 測稽核）。全部 172 項通過；lint、typecheck、build 通過。

## 還沒做（S6 其餘，後續分刀）
middleware（`/admin/**`、`/api/admin/**` 檢查 cookie）、`/admin/login` 頁與 server action（接上 limiter／loginAdmin／cookie 設定：httpOnly、SameSite=Lax、Secure）、IP 取得方式（Cloudflare Tunnel 後應取 `CF-Connecting-IP`）、`/api/admin/photos/[id]`、儀表板／景點／參加者／審核／獎品／設定／範本／稽核頁、手動新增 submission、Playwright E2E。接線時：env 的 `ADMIN_AUTH_SOURCE` 對應 factory 尚未寫（比照 `employees/factory.ts`）。

## 我採用的假設（需 David 確認）
1. **備援登入的帳號名固定為 `break-glass`**，密碼對照 `ADMIN_PASSWORD_HASH`；規格沒指定帳號名。
2. **雜湊格式用 scrypt**（Node 內建、不增依賴）；規格沒指定演算法。
3. 速率限制為**記憶體內、只計失敗**（單一 app 容器足夠；重啟即清零）。若要「成功也計次」或跨容器共用需改。
4. 一般登入成功也寫稽核（`auth.login`），方便追溯；規格只要求備援必寫。

## 驗證限制
未接真實請假系統（API 尚未定案）；所有測試使用假帳號、假 token 與本機 mock server。無 LINE 呼叫、無真實資料。


---

# S6b 交接（第二刀：proxy、登入頁、E2E）

## 做了什麼
- `src/proxy.ts`（Next 16 的 middleware 新名稱，Node runtime）：matcher `/admin/:path*`、`/api/admin/:path*`；判斷邏輯在 `lib/auth/guard.ts`（`decideAdminAccess`，可單測）。`/admin/login` 放行；未登入頁面 → 導向登入頁，API → 401；SESSION_SECRET 未設定一律視為未登入。這只是樂觀檢查，之後各 handler 仍應用 `getAdminSession()`（`lib/auth/current.ts`）自行取 session。
- `lib/auth/login.ts`：`performLogin`（限速 → loginAdmin → 稽核 → 簽 token；只有帳密錯誤計入失敗、服務不可用不計；無 SESSION_SECRET 回 misconfigured）、`clientIp`（優先 `CF-Connecting-IP`，其次 `X-Forwarded-For` 第一段）。
- `lib/auth/factory.ts`：依 `ADMIN_AUTH_SOURCE` 建 authenticator（mock 固定測試帳號 `test-manager`／`test-password`，皆假資料，production 拒絕）。
- `/admin/login` 頁 + server action（cookie：httpOnly、SameSite=Lax、production 時 Secure、24 小時）、`/admin` 最小首頁（顯示 actor、登出按鈕）。
- `getDb()` 對記憶體 PGlite 自動跑 migration；`next.config.ts` 加 `serverExternalPackages: ["@electric-sql/pglite"]`（否則 Next 打包後 PGlite 在 dev server 無法載入）。
- Playwright `e2e/admin-login.spec.ts` 5 項：未登入被導向、API 401、偽造 cookie 被擋、錯誤密碼、登入→首頁→登出→再被擋。`playwright.config.ts` 注入假的 `ADMIN_AUTH_SOURCE=mock`、`SESSION_SECRET`。
- 新增單元測試 `login.test.ts`；全部 182 項 + E2E 6 項通過；lint、typecheck、build 通過。

## 還沒做
照片串流 `/api/admin/photos/[id]`、儀表板／景點／參加者／審核／獎品／設定／範本／稽核頁、手動新增 submission、登出稽核、登入 `next` 回跳。CI 目前沒跑 Playwright（需安裝瀏覽器），E2E 僅本機執行；是否加進 CI 請 David 決定。

## 維持現有預設、請 David 決定（沒改）
1. 備援帳號名固定為 `break-glass`，密碼對照 `ADMIN_PASSWORD_HASH`（見上一段假設 1）。
2. 備援登入不受「帳號存在」限制，但仍受 IP 速率限制；備援登入成功只寫稽核、沒有通知。
3. 速率限制為單一容器記憶體計數，key 為來源 IP；若 Cloudflare 標頭可被偽造（未經 Tunnel 直連）則可被繞過，請確認 app 只經 Tunnel 對外。
4. session 無伺服器端撤銷（登出只清 cookie，被竊 token 24 小時內有效）。

## 驗證限制
只用 mock 帳號與假密鑰，無 LINE 呼叫、無真實請假系統。
