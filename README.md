# eucan-lucky-draw-system

公司員工旅遊景點合照抽獎系統：員工透過 LINE 官方帳號上傳與指定景點的合照取得抽獎資格，系統自動抽獎並以 LINE 通知得獎者。

規格與架構文件見 [`docs/`](./docs)。

## 本機啟動

需求：Node.js 22+、pnpm（`npm i -g pnpm`）。

```bash
pnpm install
cp .env.example .env     # 填入各鍵值（本機可用假值；ADMIN_AUTH_SOURCE=mock）
pnpm dev                 # http://localhost:3000，首頁顯示活動名稱
```

缺少必要環境變數時，啟動會出現錯誤訊息並列出缺少的鍵（`src/env.ts`）。`APP_ENV=test` 時允許缺值。

## 常用指令

| 指令 | 說明 |
|---|---|
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript 型別檢查 |
| `pnpm test` | Vitest 單元測試 |
| `pnpm test:e2e` | Playwright smoke test（首次需 `pnpm exec playwright install chromium`） |
| `pnpm build` | 正式建置（standalone） |

CI（`.github/workflows/ci.yml`）會執行 lint、typecheck、test、build；build 使用 workflow 中標明的 dummy env 值。
