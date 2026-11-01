# S1 交接

## 做了什麼
- Next.js 16.4.3（App Router、TS strict、Tailwind 4、ESLint、`src/`、pnpm 12）骨架；`output: 'standalone'`。
- `src/env.ts`：zod 驗證 spec §7.1 的 env（`parseEnv` 純函式 + `getEnv` 快取）；`src/instrumentation.ts` 於伺服器啟動時呼叫，缺值會列出缺少的鍵並中止。`APP_ENV=test` 允許缺值。
- Vitest（`src/env.test.ts`，6 項）、Playwright（設定 + `e2e/smoke.spec.ts`，埠 3100，`APP_ENV=test`）。
- `.env.example`（僅鍵名）、`.github/workflows/ci.yml`（lint/typecheck/test/build，dummy env）、README 本機啟動。
- 首頁顯示 `DEFAULT_EVENT_NAME`（`src/lib/event.ts`）；S2 之後改讀 settings 的 `event.name`。

## 驗證結果（本機）
lint、typecheck、test、build 通過；`pnpm test:e2e` 通過；缺 env 啟動 dev/start 會顯示缺少的鍵。**CI 綠燈需 push 後在 GitHub 確認。**

## 決策／注意
- `typecheck` = `next typegen && tsc --noEmit`（`LayoutProps` 型別由 typegen 產生）。
- 移除 create-next-app 預設的 `cacheComponents`／`partialPrefetching`（實驗設定，非 S1 需求）。
- `ADMIN_AUTH_SOURCE=leave-api` 時 `LEAVE_API_BASE_URL/TOKEN` 必填；production 禁用 `mock`；`TUNNEL_TOKEN` 不在 app 驗證範圍。
- `next build` 不會觸發 env 驗證（instrumentation 只在伺服器啟動時執行），因此 build 不需真 env，但 CI 仍設 dummy 值。
- `AGENTS.md`（Next.js 提供的 agent 規則）一併納入版控。
- `.agents/*.log` 與 task 檔保持未追蹤/未動。

## 下一步
S2：資料庫結構與設定模組。
