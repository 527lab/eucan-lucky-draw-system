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
