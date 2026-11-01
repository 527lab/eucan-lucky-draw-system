import { defineConfig } from "@playwright/test";

// E2E 使用 APP_ENV=test（允許缺 env），不連真實 LINE。
export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3100" },
  webServer: {
    command: "pnpm dev --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    env: { APP_ENV: "test" },
  },
});
