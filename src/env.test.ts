import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "./env";

const full = {
  APP_ENV: "development",
  LINE_CHANNEL_SECRET: "dummy",
  LINE_CHANNEL_ACCESS_TOKEN: "dummy",
  DATABASE_URL: "postgres://dummy",
  PHOTO_STORAGE_DIR: "/tmp/photos",
  SESSION_SECRET: "dummy",
  CRON_SECRET: "dummy",
  APP_BASE_URL: "http://localhost:3000",
  ADMIN_AUTH_SOURCE: "mock",
};

describe("parseEnv", () => {
  it("完整設定時通過", () => {
    expect(parseEnv(full).APP_BASE_URL).toBe("http://localhost:3000");
  });

  it("缺少必要鍵時列出所有缺少的鍵", () => {
    const rest: Record<string, string> = { ...full };
    delete rest.LINE_CHANNEL_SECRET;
    delete rest.DATABASE_URL;
    try {
      parseEnv(rest);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      const err = e as EnvError;
      expect(err.missing).toEqual(
        expect.arrayContaining(["LINE_CHANNEL_SECRET", "DATABASE_URL"]),
      );
      expect(err.message).toContain("LINE_CHANNEL_SECRET");
    }
  });

  it("空字串視為缺值", () => {
    expect(() => parseEnv({ ...full, SESSION_SECRET: "" })).toThrow(
      /SESSION_SECRET/,
    );
  });

  it("leave-api 來源需要 LEAVE_API_*", () => {
    expect(() => parseEnv({ ...full, ADMIN_AUTH_SOURCE: "leave-api" })).toThrow(
      /LEAVE_API_BASE_URL.*LEAVE_API_TOKEN/,
    );
  });

  it("production 不可使用 mock 驗證", () => {
    expect(() => parseEnv({ ...full, APP_ENV: "production" })).toThrow(/mock/);
  });

  it("APP_ENV=test 時允許缺值", () => {
    expect(parseEnv({ APP_ENV: "test" }).APP_ENV).toBe("test");
  });
});
