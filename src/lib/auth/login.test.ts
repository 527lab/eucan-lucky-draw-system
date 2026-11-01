import { describe, expect, it } from "vitest";
import { createMockAuthenticator } from "./admin-authenticator";
import { decideAdminAccess, isAdminPath } from "./guard";
import { clientIp, performLogin, type LoginDeps } from "./login";
import { LoginRateLimiter } from "./rate-limit";
import { createSessionToken, verifySessionToken } from "./session";
import { createAdminAuthenticator } from "./factory";
import { createTestDb } from "../db/test-helper";
import { adminAuditLogs } from "../db/schema";

const SECRET = "test-secret";
const NOW = 1_700_000_000_000;

async function deps(over: Partial<LoginDeps> = {}) {
  const h = await createTestDb();
  const d: LoginDeps = {
    authenticator: createMockAuthenticator(
      { m: { password: "pw", employeeNo: "E1", name: "甲" } },
      { appEnv: "test" },
    ),
    limiter: new LoginRateLimiter(),
    db: async () => h.db,
    sessionSecret: SECRET,
    nowMs: NOW,
    ...over,
  };
  return { d, db: h.db };
}

describe("decideAdminAccess", () => {
  const token = createSessionToken({ employeeNo: "E1", name: "甲" }, SECRET, NOW);
  it("非後台路徑放行、登入頁放行", () => {
    expect(isAdminPath("/administrator")).toBe(false);
    expect(decideAdminAccess("/", undefined, SECRET, NOW)).toBe("allow");
    expect(decideAdminAccess("/admin/login", undefined, SECRET, NOW)).toBe("allow");
  });
  it("未登入：頁面導向、API 401", () => {
    expect(decideAdminAccess("/admin", undefined, SECRET, NOW)).toBe("redirect-login");
    expect(decideAdminAccess("/admin/x/y", "bad", SECRET, NOW)).toBe("redirect-login");
    expect(decideAdminAccess("/api/admin/photos/1", undefined, SECRET, NOW)).toBe("unauthorized");
  });
  it("有效 cookie 放行；過期、簽章錯、無密鑰都擋", () => {
    expect(decideAdminAccess("/admin", token, SECRET, NOW + 1000)).toBe("allow");
    expect(decideAdminAccess("/admin", token, SECRET, NOW + 25 * 3600_000)).toBe("redirect-login");
    expect(decideAdminAccess("/admin", token, "other", NOW)).toBe("redirect-login");
    expect(decideAdminAccess("/admin", token, undefined, NOW)).toBe("redirect-login");
  });
});

describe("performLogin", () => {
  it("成功：簽發可驗證的 token 並寫稽核", async () => {
    const { d, db } = await deps();
    const r = await performLogin({ account: "m", password: "pw", ip: "1.1.1.1" }, d);
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(verifySessionToken(r.token, SECRET, NOW)?.employeeNo).toBe("E1");
    }
    const rows = await db.select().from(adminAuditLogs);
    expect(rows.map((x) => x.action)).toEqual(["auth.login"]);
    expect(rows[0].actor).toBe("E1 甲");
  });
  it("密碼錯誤累計後第 6 次回 rate-limited，即使密碼正確", async () => {
    const { d } = await deps();
    for (let i = 0; i < 5; i++) {
      const r = await performLogin({ account: "m", password: "x", ip: "2.2.2.2" }, d);
      expect(r.status).toBe("invalid");
    }
    const r = await performLogin({ account: "m", password: "pw", ip: "2.2.2.2" }, d);
    expect(r.status).toBe("rate-limited");
    const other = await performLogin({ account: "m", password: "pw", ip: "3.3.3.3" }, d);
    expect(other.status).toBe("ok");
  });
  it("驗證服務不可用：unavailable，不計失敗、不簽發", async () => {
    const { d } = await deps({
      authenticator: createMockAuthenticator({}, { appEnv: "test", unavailable: true }),
    });
    for (let i = 0; i < 7; i++) {
      expect((await performLogin({ account: "m", password: "pw", ip: "4.4.4.4" }, d)).status).toBe(
        "unavailable",
      );
    }
  });
  it("沒有 SESSION_SECRET 時拒絕登入", async () => {
    const { d } = await deps({ sessionSecret: undefined });
    expect((await performLogin({ account: "m", password: "pw", ip: "5.5.5.5" }, d)).status).toBe(
      "misconfigured",
    );
  });
  it("空帳密視為 invalid", async () => {
    const { d } = await deps();
    expect((await performLogin({ account: "", password: "", ip: "6.6.6.6" }, d)).status).toBe(
      "invalid",
    );
  });
});

describe("clientIp / factory", () => {
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
  it("優先 CF-Connecting-IP，其次 XFF 第一段，否則 unknown", () => {
    expect(clientIp(h({ "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" }))).toBe("9.9.9.9");
    expect(clientIp(h({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientIp(h({}))).toBe("unknown");
  });
  it("mock 在 production 拒絕建立；mock 測試帳號可登入", async () => {
    expect(() => createAdminAuthenticator({ ADMIN_AUTH_SOURCE: "mock", APP_ENV: "production" })).toThrow();
    const a = createAdminAuthenticator({ ADMIN_AUTH_SOURCE: "mock", APP_ENV: "test" });
    expect(await a.authenticate("test-manager", "test-password")).not.toBeNull();
  });
});
