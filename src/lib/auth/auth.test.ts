import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { adminAuditLogs } from "../db/schema";
import { createTestDb } from "../db/test-helper";
import {
  AuthUnavailableError,
  createLeaveApiAuthenticator,
  createMockAuthenticator,
  loginAdmin,
  type AdminAuthenticator,
} from "./admin-authenticator";
import { auditLogin } from "./audit";
import { hashPassword, verifyPassword } from "./password-hash";
import { LoginRateLimiter } from "./rate-limit";
import {
  createSessionToken,
  formatActor,
  SESSION_TTL_MS,
  verifySessionToken,
} from "./session";

// 全為測試用假資料。
const SECRET = "test-session-secret-not-real";
const T0 = 1_800_000_000_000;

describe("session", () => {
  const id = { employeeNo: "A1234", name: "王小明" };

  it("簽發後可驗證，24 小時後過期", () => {
    const token = createSessionToken(id, SECRET, T0);
    expect(verifySessionToken(token, SECRET, T0 + 1000)).toMatchObject({
      employeeNo: "A1234",
      name: "王小明",
      breakGlass: false,
    });
    expect(verifySessionToken(token, SECRET, T0 + SESSION_TTL_MS - 1)).not.toBeNull();
    expect(verifySessionToken(token, SECRET, T0 + SESSION_TTL_MS)).toBeNull();
  });

  it("竄改內容、錯誤 secret、格式錯誤、空值都拒絕", () => {
    const token = createSessionToken(id, SECRET, T0);
    const [body, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...id, breakGlass: true, exp: T0 + 1e12 }),
    ).toString("base64url");
    expect(verifySessionToken(`${forged}.${sig}`, SECRET, T0)).toBeNull();
    expect(verifySessionToken(token, "other-secret", T0)).toBeNull();
    expect(verifySessionToken(`${body}.`, SECRET, T0)).toBeNull();
    expect(verifySessionToken("abc", SECRET, T0)).toBeNull();
    expect(verifySessionToken(`${body}.${sig}.x`, SECRET, T0)).toBeNull();
    expect(verifySessionToken(undefined, SECRET, T0)).toBeNull();
    expect(verifySessionToken(token, "", T0)).toBeNull();
  });

  it("簽章正確但內容不是合法 session 時拒絕", () => {
    // 用同一把 secret 簽出非 JSON／缺欄位的內容。
    const forgeWith = (payload: string) => {
      const body = Buffer.from(payload).toString("base64url");
      return `${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
    };
    expect(verifySessionToken(forgeWith("not json"), SECRET, T0)).toBeNull();
    expect(verifySessionToken(forgeWith("123"), SECRET, T0)).toBeNull();
    expect(verifySessionToken(forgeWith("null"), SECRET, T0)).toBeNull();
    expect(
      verifySessionToken(forgeWith(JSON.stringify({ employeeNo: "A1" })), SECRET, T0),
    ).toBeNull();
  });

  it("formatActor：一般為「員工編號 姓名」，備援為 break-glass", () => {
    expect(formatActor({ ...id, breakGlass: false })).toBe("A1234 王小明");
    expect(formatActor({ employeeNo: "break-glass", name: "", breakGlass: true })).toBe(
      "break-glass",
    );
  });
});

describe("password hash", () => {
  it("正確密碼通過、錯誤不通過、每次 salt 不同", async () => {
    const h1 = await hashPassword("correct horse");
    const h2 = await hashPassword("correct horse");
    expect(h1).not.toBe(h2);
    expect(h1).not.toContain("correct horse");
    expect(await verifyPassword("correct horse", h1)).toBe(true);
    expect(await verifyPassword("wrong", h1)).toBe(false);
  });
  it("格式錯誤的雜湊一律不放行", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "plain-text")).toBe(false);
    expect(await verifyPassword("x", "scrypt$$")).toBe(false);
    expect(await verifyPassword("x", "scrypt$AAAA$AAAA")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$AAAA$AAAA")).toBe(false);
  });
});

describe("LoginRateLimiter", () => {
  it("同 key 一分鐘內第 5 次失敗後被擋，視窗過後恢復", () => {
    const rl = new LoginRateLimiter(5, 60_000);
    for (let i = 0; i < 5; i++) {
      expect(rl.check("1.2.3.4", T0 + i)).toBeNull();
      rl.recordFailure("1.2.3.4", T0 + i);
    }
    const blocked = rl.check("1.2.3.4", T0 + 10_000);
    expect(blocked).not.toBeNull();
    expect(blocked?.retryAfterSeconds).toBe(50);
    expect(rl.check("5.6.7.8", T0 + 10_000)).toBeNull();
    expect(rl.check("1.2.3.4", T0 + 60_000)).toBeNull();
  });
  it("reset 後清除計數", () => {
    const rl = new LoginRateLimiter(1, 60_000);
    rl.recordFailure("ip", T0);
    expect(rl.check("ip", T0)).not.toBeNull();
    rl.reset("ip");
    expect(rl.check("ip", T0)).toBeNull();
  });
});

describe("mock authenticator", () => {
  const accounts = { boss: { password: "pw-1", employeeNo: "M001", name: "測試主管" } };
  it("帳密正確通過、錯誤或不存在回 null", async () => {
    const a = createMockAuthenticator(accounts, { appEnv: "test" });
    expect(await a.authenticate("boss", "pw-1")).toEqual({ employeeNo: "M001", name: "測試主管" });
    expect(await a.authenticate("boss", "bad")).toBeNull();
    expect(await a.authenticate("nobody", "pw-1")).toBeNull();
    expect(await a.authenticate("__proto__", "x")).toBeNull();
  });
  it("production 不可建立；unavailable 模擬故障", async () => {
    expect(() => createMockAuthenticator(accounts, { appEnv: "production" })).toThrow();
    const a = createMockAuthenticator(accounts, { appEnv: "development", unavailable: true });
    await expect(a.authenticate("boss", "pw-1")).rejects.toBeInstanceOf(AuthUnavailableError);
  });
});

describe("leave-api authenticator（mock server）", () => {
  let server: Server;
  let baseUrl: string;
  let handler: (body: string, auth: string | undefined) => { status: number; body: string; delayMs?: number };
  const seen: { body: string; auth: string | undefined; url: string | undefined; method?: string }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        seen.push({ body: data, auth: req.headers.authorization, url: req.url, method: req.method });
        const r = handler(data, req.headers.authorization);
        setTimeout(() => {
          res.statusCode = r.status;
          res.setHeader("content-type", "application/json");
          res.end(r.body);
        }, r.delayMs ?? 0);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });
  afterEach(() => {
    seen.length = 0;
  });

  const make = (timeoutMs?: number) =>
    createLeaveApiAuthenticator({ baseUrl: `${baseUrl}/`, token: "fake-token", timeoutMs });

  it("ok && isManager 放行，並以 POST＋Bearer 呼叫正確路徑", async () => {
    handler = () => ({
      status: 200,
      body: JSON.stringify({ ok: true, employeeNo: "M001", name: "王主管", isManager: true }),
    });
    expect(await make().authenticate("boss", "pw")).toEqual({ employeeNo: "M001", name: "王主管" });
    expect(seen[0]).toMatchObject({
      method: "POST",
      url: "/api/integrations/auth/verify",
      auth: "Bearer fake-token",
    });
    expect(JSON.parse(seen[0].body)).toEqual({ account: "boss", password: "pw" });
  });

  it("ok:false、非主管 → null", async () => {
    handler = () => ({ status: 200, body: JSON.stringify({ ok: false }) });
    expect(await make().authenticate("boss", "bad")).toBeNull();
    handler = () => ({
      status: 200,
      body: JSON.stringify({ ok: true, employeeNo: "E9", name: "一般員工", isManager: false }),
    });
    expect(await make().authenticate("emp", "pw")).toBeNull();
  });

  it.each([
    ["5xx", { status: 503, body: "{}" }],
    ["401", { status: 401, body: "{}" }],
    ["非 JSON", { status: 200, body: "<html>" }],
    ["缺 ok 欄位", { status: 200, body: "{}" }],
    ["JSON 為 null", { status: 200, body: "null" }],
    ["ok 但缺 isManager", { status: 200, body: JSON.stringify({ ok: true, employeeNo: "A", name: "n" }) }],
    ["ok 但員工編號為空", { status: 200, body: JSON.stringify({ ok: true, employeeNo: "", name: "n", isManager: true }) }],
  ])("%s → AuthUnavailableError（不放行）", async (_label, resp) => {
    handler = () => resp;
    await expect(make().authenticate("boss", "pw")).rejects.toBeInstanceOf(AuthUnavailableError);
  });

  it("逾時 → AuthUnavailableError", async () => {
    handler = () => ({ status: 200, body: JSON.stringify({ ok: false }), delayMs: 300 });
    await expect(make(50).authenticate("boss", "pw")).rejects.toBeInstanceOf(AuthUnavailableError);
  });

  it("連線失敗、設定缺漏 → AuthUnavailableError，錯誤訊息不含密碼", async () => {
    const dead = createLeaveApiAuthenticator({ baseUrl: "http://127.0.0.1:1", token: "t", timeoutMs: 500 });
    const err = await dead.authenticate("boss", "super-secret-pw").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthUnavailableError);
    expect(JSON.stringify(err) + String((err as Error).message) + String((err as Error).cause)).not.toContain(
      "super-secret-pw",
    );
    await expect(
      createLeaveApiAuthenticator({ baseUrl: undefined, token: undefined }).authenticate("a", "b"),
    ).rejects.toBeInstanceOf(AuthUnavailableError);
  });
});

describe("loginAdmin 與緊急備援", () => {
  const primaryOk: AdminAuthenticator = {
    authenticate: async () => ({ employeeNo: "M001", name: "王主管" }),
  };
  const primaryNull: AdminAuthenticator = { authenticate: async () => null };
  const primaryDown: AdminAuthenticator = {
    authenticate: async () => {
      throw new AuthUnavailableError("down");
    },
  };

  it("主要驗證：通過 / 不通過 / 不可用", async () => {
    expect(await loginAdmin("boss", "pw", { primary: primaryOk })).toEqual({
      status: "ok",
      identity: { employeeNo: "M001", name: "王主管" },
      breakGlass: false,
    });
    expect(await loginAdmin("boss", "pw", { primary: primaryNull })).toEqual({ status: "invalid" });
    expect(await loginAdmin("boss", "pw", { primary: primaryDown })).toEqual({
      status: "unavailable",
    });
  });

  it("非預期例外不被吞掉", async () => {
    const boom: AdminAuthenticator = {
      authenticate: async () => {
        throw new Error("bug");
      },
    };
    await expect(loginAdmin("boss", "pw", { primary: boom })).rejects.toThrow("bug");
  });

  it("未設定 ADMIN_PASSWORD_HASH：break-glass 無法使用（只交給主要驗證）", async () => {
    const spy = vi.fn(primaryNull.authenticate);
    const r = await loginAdmin("break-glass", "anything", { primary: { authenticate: spy } });
    expect(r).toEqual({ status: "invalid" });
    expect(spy).toHaveBeenCalledOnce();
  });

  it("設定後：正確密碼可登入（即使請假系統掛了），錯誤密碼不行，且不呼叫主要驗證", async () => {
    const hash = await hashPassword("emergency-pw");
    const spy = vi.fn(primaryDown.authenticate);
    const primary = { authenticate: spy };
    const ok = await loginAdmin("break-glass", "emergency-pw", { primary, breakGlassHash: hash });
    expect(ok).toMatchObject({ status: "ok", breakGlass: true });
    expect(await loginAdmin("break-glass", "nope", { primary, breakGlassHash: hash })).toEqual({
      status: "invalid",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("備援密碼不能用在一般帳號名", async () => {
    const hash = await hashPassword("emergency-pw");
    const r = await loginAdmin("boss", "emergency-pw", {
      primary: primaryNull,
      breakGlassHash: hash,
    });
    expect(r).toEqual({ status: "invalid" });
  });
});

describe("登入稽核", () => {
  it("備援登入寫 auth.login.break-glass，actor 為 break-glass，紀錄不含密碼", async () => {
    const handle = await createTestDb();
    try {
      await auditLogin(handle.db, { actor: "break-glass", breakGlass: true });
      await auditLogin(handle.db, { actor: "M001 王主管", breakGlass: false });
      const rows = await handle.db.select().from(adminAuditLogs);
      expect(rows.map((r) => [r.actor, r.action]).sort()).toEqual([
        ["M001 王主管", "auth.login"],
        ["break-glass", "auth.login.break-glass"],
      ]);
      expect(JSON.stringify(rows)).not.toMatch(/password/i);
    } finally {
      await handle.close();
    }
  });
});
