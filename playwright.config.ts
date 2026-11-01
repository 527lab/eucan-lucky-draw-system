import { defineConfig } from "@playwright/test";

// E2E 使用 APP_ENV=test（允許缺 env），不連真實 LINE。
export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3100" },
  webServer: {
    command: "pnpm dev --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    // 全部是假值：mock 登入、假 session 密鑰，不連 LINE 與真實請假系統。
    env: {
      APP_ENV: "test",
      ADMIN_FIXTURES: "1", // 記憶體 PGlite 載入虛構展示資料
      ADMIN_AUTH_SOURCE: "mock",
      SESSION_SECRET: "e2e-fake-session-secret",
    },
  },
});
