import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbHandle } from "../db/client";
import { adminAuditLogs, employeeAllowlist, participants, submissions } from "../db/schema";
import { createTestDb } from "../db/test-helper";
import { updateSetting } from "../settings";
import type { LineClient } from "../line/client";
import { registrationHandler } from "../line/handlers/message";
import { computeSignature } from "../line/signature";
import { receiveWebhook } from "../line/webhook";
import { createCsvVerifier, createLeaveApiVerifier, createMockVerifier } from "./adapters";
import { parseAllowlistCsv, replaceAllowlist, suspendParticipant } from "./admin";
import { createVerifier } from "./factory";
import { installRegistrationHandler, parseRegistration, registerEmployee } from "./register";
import { normalizeEmployeeNo, VerifierUnavailableError } from "./verifier";

describe("normalizeEmployeeNo", () => {
  it("trim、全形轉半形", () => {
    expect(normalizeEmployeeNo("  Ａ１２３４ ")).toBe("A1234");
  });
  it("空、含空白、過長都拒絕", () => {
    expect(normalizeEmployeeNo("   ")).toBeNull();
    expect(normalizeEmployeeNo("A 1234")).toBeNull();
    expect(normalizeEmployeeNo("A".repeat(33))).toBeNull();
    expect(normalizeEmployeeNo("A".repeat(32))).toBe("A".repeat(32));
  });
});

describe("parseRegistration", () => {
  const p = (t: string, c = "參加") => parseRegistration(t, c);
  it("有無空白皆可", () => {
    expect(p("參加A1234")).toEqual({ kind: "attempt", employeeNo: "A1234" });
    expect(p("參加 A1234")).toEqual({ kind: "attempt", employeeNo: "A1234" });
  });
  it("全形", () => {
    expect(p("參加　Ａ１２３４")).toEqual({ kind: "attempt", employeeNo: "A1234" });
  });
  it("只有指令回用法", () => {
    expect(p("參加")).toEqual({ kind: "usage" });
    expect(p("參加  ")).toEqual({ kind: "usage" });
  });
  it("自訂指令", () => {
    expect(p("報到 B77", "報到")).toEqual({ kind: "attempt", employeeNo: "B77" });
    expect(p("參加 B77", "報到")).toEqual({ kind: "none" });
  });
  it("編號含空白或過長 → employeeNo null", () => {
    expect(p("參加 A 12")).toEqual({ kind: "attempt", employeeNo: null });
    expect(p(`參加 ${"9".repeat(40)}`)).toEqual({ kind: "attempt", employeeNo: null });
  });
  it("非指令", () => {
    expect(p("說明")).toEqual({ kind: "none" });
  });
});

describe("轉接器", () => {
  let handle: DbHandle;
  beforeEach(async () => {
    handle = await createTestDb();
  });
  afterEach(async () => {
    await handle.close();
  });

  it("csv：有效、無效（含離職＝不在名單）", async () => {
    await handle.db.insert(employeeAllowlist).values([{ employeeNo: "A1" }]);
    const v = createCsvVerifier(handle.db);
    expect(await v.verify("A1")).toEqual({ valid: true });
    expect(await v.verify("A2")).toEqual({ valid: false });
    expect(await v.verify("a1")).toEqual({ valid: false });
  });

  it("mock：有效、無效、故障", async () => {
    const v = createMockVerifier(["A1"]);
    expect(await v.verify("A1")).toEqual({ valid: true });
    expect(await v.verify("RESIGNED")).toEqual({ valid: false });
    await expect(createMockVerifier([], { unavailable: true }).verify("A1")).rejects.toBeInstanceOf(
      VerifierUnavailableError,
    );
  });

  it("factory 依 employees.source 選轉接器；leave-api 缺環境變數 → 不放行", async () => {
    const csv = createVerifier(handle.db, { "employees.source": "csv" }, {});
    expect(await csv.verify("X")).toEqual({ valid: false });
    const api = createVerifier(handle.db, { "employees.source": "leave-api" }, {});
    await expect(api.verify("X")).rejects.toBeInstanceOf(VerifierUnavailableError);
  });
});

describe("leave-api 轉接器（mock fetch）", () => {
  const mk = (fetchImpl: typeof fetch, timeoutMs?: number) =>
    createLeaveApiVerifier({
      baseUrl: "https://leave.example.test/",
      token: "dummy-token-for-test",
      fetchImpl,
      timeoutMs,
    });
  const json = (body: unknown, status = 200) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("200 valid true／false；請求帶 Bearer、編號有 URL 編碼", async () => {
    const f = vi.fn(json({ valid: true }));
    expect(await mk(f).verify("A/1")).toEqual({ valid: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://leave.example.test/api/integrations/employees/A%2F1/status");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer dummy-token-for-test",
    );
    expect(await mk(json({ valid: false })).verify("A1")).toEqual({ valid: false });
  });

  it.each([
    ["5xx", json({ valid: true }, 503)],
    ["4xx", json({ valid: true }, 401)],
    ["格式錯誤", json({ ok: true })],
    ["valid 不是布林", json({ valid: "true" })],
    ["非 JSON", (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch],
    [
      "網路錯誤",
      (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    ],
  ])("%s → VerifierUnavailableError（不放行）", async (_n, f) => {
    await expect(mk(f).verify("A1")).rejects.toBeInstanceOf(VerifierUnavailableError);
  });

  it("逾時 → VerifierUnavailableError", async () => {
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_res, rej) => {
        init.signal?.addEventListener("abort", () => rej(init.signal?.reason));
      })) as unknown as typeof fetch;
    await expect(mk(hang, 30).verify("A1")).rejects.toBeInstanceOf(VerifierUnavailableError);
  });
});

describe("leave-api 轉接器（本機 HTTP mock server）", () => {
  it("真實 fetch 對 mock server：200／500／逾時", async () => {
    const http = await import("node:http");
    const server = http.createServer((req, res) => {
      if (req.url?.includes("/employees/OK/")) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ valid: true }));
      } else if (req.url?.includes("/employees/ERR/")) {
        res.statusCode = 500;
        res.end("boom");
      } // 其他：不回應，測逾時
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const v = createLeaveApiVerifier({
      baseUrl: `http://127.0.0.1:${port}`,
      token: "dummy-token-for-test",
      timeoutMs: 200,
    });
    try {
      expect(await v.verify("OK")).toEqual({ valid: true });
      await expect(v.verify("ERR")).rejects.toBeInstanceOf(VerifierUnavailableError);
      await expect(v.verify("HANG")).rejects.toBeInstanceOf(VerifierUnavailableError);
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });
});

describe("registerEmployee", () => {
  let handle: DbHandle;
  const now = new Date("2026-12-01T00:00:00Z");
  const v = () => createMockVerifier(["A1", "A2"]);
  beforeEach(async () => {
    handle = await createTestDb();
  });
  afterEach(async () => {
    await handle.close();
  });
  const row = async (u: string) =>
    (await handle.db.select().from(participants).where(eq(participants.lineUserId, u)))[0];

  it("通過 → 寫入 employee_no、verified_at、active", async () => {
    expect(await registerEmployee(handle.db, "U1", "A1", v(), now)).toBe("success");
    const r = await row("U1");
    expect(r).toMatchObject({ employeeNo: "A1", status: "active" });
    expect(r.employeeVerifiedAt).toEqual(now);
  });

  it("無效編號／格式不可接受 → invalid，不綁定", async () => {
    expect(await registerEmployee(handle.db, "U1", "NOPE", v(), now)).toBe("invalid");
    expect(await registerEmployee(handle.db, "U1", null, v(), now)).toBe("invalid");
    expect((await row("U1")).status).toBe("pending_registration");
  });

  it("同帳號重複輸入同編號視為成功；輸入別的編號回 already", async () => {
    await registerEmployee(handle.db, "U1", "A1", v(), now);
    expect(await registerEmployee(handle.db, "U1", "A1", v(), now)).toBe("success");
    expect(await registerEmployee(handle.db, "U1", "A2", v(), now)).toBe("already");
    expect((await row("U1")).employeeNo).toBe("A1");
  });

  it("查證故障 → busy，不放行", async () => {
    const down = createMockVerifier(["A1"], { unavailable: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await registerEmployee(handle.db, "U1", "A1", down, now)).toBe("busy");
    expect((await row("U1")).status).toBe("pending_registration");
    warn.mockRestore();
  });

  it("同編號多個帳號並發 → 只有一個成功，其餘 taken", async () => {
    const results = await Promise.all(
      ["U1", "U2", "U3"].map((u) => registerEmployee(handle.db, u, "A1", v(), now)),
    );
    expect(results.filter((r) => r === "success")).toHaveLength(1);
    expect(results.filter((r) => r === "taken")).toHaveLength(2);
    const owners = await handle.db
      .select()
      .from(participants)
      .where(eq(participants.employeeNo, "A1"));
    expect(owners).toHaveLength(1);
  });

  it("停權者不能報名；停權後編號釋出，其他帳號可報名並寫稽核", async () => {
    await registerEmployee(handle.db, "U1", "A1", v(), now);
    expect(await registerEmployee(handle.db, "U2", "A1", v(), now)).toBe("taken");
    const u1 = await row("U1");
    await suspendParticipant(handle.db, u1.id, "E001 測試員");
    expect(await row("U1")).toMatchObject({ status: "blocked", employeeNo: null });
    expect(await registerEmployee(handle.db, "U1", "A1", v(), now)).toBe("blocked");
    expect(await registerEmployee(handle.db, "U2", "A1", v(), now)).toBe("success");
    const logs = await handle.db.select().from(adminAuditLogs);
    expect(logs.map((l) => l.action)).toContain("participant.suspend");
    await expect(
      suspendParticipant(handle.db, "00000000-0000-0000-0000-000000000000", "x"),
    ).rejects.toThrow();
  });
});

describe("名單上傳", () => {
  it("解析：BOM、標頭、引號、去重、正規化、拒收", () => {
    const csv = `﻿員工編號\r\nA1\n"B2"\nＡ1\n\nbad id\n${"X".repeat(40)}\nC3,忽略的第二欄`;
    const r = parseAllowlistCsv(csv);
    expect(r.numbers.sort()).toEqual(["A1", "B2", "C3"]);
    expect(r.rejected).toBe(2);
  });

  it("覆蓋名單並寫稽核（只記數量）；空名單拒絕且不清除原名單", async () => {
    const handle = await createTestDb();
    await replaceAllowlist(handle.db, "A1\nA2\n", "E001 測試員");
    await replaceAllowlist(handle.db, "A3\n", "E001 測試員");
    const all = await handle.db.select().from(employeeAllowlist);
    expect(all.map((x) => x.employeeNo)).toEqual(["A3"]);
    await expect(replaceAllowlist(handle.db, "\n\n", "E001 測試員")).rejects.toThrow();
    expect(await handle.db.select().from(employeeAllowlist)).toHaveLength(1);
    const logs = await handle.db.select().from(adminAuditLogs);
    expect(logs).toHaveLength(2);
    expect(JSON.stringify(logs)).not.toContain("A3");
    await handle.close();
  });
});

describe("整合：webhook → 報名", () => {
  const SECRET = "test-secret-not-real";
  let handle: DbHandle;
  let replies: string[];
  let seq = 0;
  const client = (): LineClient =>
    ({
      async replyMessage(_t: string, m: unknown[]) {
        replies.push((m[0] as { text: string }).text);
      },
      async getProfile() {
        return { displayName: "小明" };
      },
      async leaveGroup() {},
      async leaveRoom() {},
    }) as unknown as LineClient;

  async function say(user: string, kind: "text" | "image", t = "") {
    seq += 1;
    const body = JSON.stringify({
      destination: "Ux",
      events: [
        {
          type: "message",
          mode: "active",
          timestamp: 1_700_000_000_000 + seq,
          source: { type: "user", userId: user },
          webhookEventId: `reg-${seq}`,
          deliveryContext: { isRedelivery: false },
          replyToken: `rt-${seq}`,
          message:
            kind === "text"
              ? { type: "text", id: `m${seq}`, text: t }
              : { type: "image", id: `m${seq}`, contentProvider: { type: "line" } },
        },
      ],
    });
    const pending: Promise<void>[] = [];
    await receiveWebhook(body, computeSignature(body, SECRET), {
      db: handle.db,
      client,
      channelSecret: SECRET,
      schedule: (task) => void pending.push(task()),
    });
    await Promise.all(pending);
    return replies[replies.length - 1];
  }

  beforeEach(async () => {
    handle = await createTestDb();
    replies = [];
    installRegistrationHandler();
    await handle.db
      .insert(employeeAllowlist)
      .values([{ employeeNo: "A1234" }, { employeeNo: "B5" }]);
  });
  afterEach(async () => {
    registrationHandler.current = null;
    await handle.close();
  });

  it("成功、重複、無效、佔用、用法", async () => {
    expect(await say("U1", "text", "參加 A1234")).toContain("已確認");
    expect(await say("U1", "text", "參加A1234")).toContain("已確認");
    expect(await say("U2", "text", "參加　Ａ１２３４")).toContain("此編號已報名");
    expect(await say("U2", "text", "參加 ZZZ")).toBe("查無此員工編號或非在職，請確認後再輸入");
    expect(await say("U2", "text", "參加")).toContain("員工編號");
    expect(await say("U2", "text", "參加 B5")).toContain("已確認");
  });

  it("自訂指令", async () => {
    await updateSetting(handle.db, "registration.command", "報到", "t");
    expect(await say("U1", "text", "報到 B5")).toContain("已確認");
  });

  it("leave-api 故障 → 系統忙碌，且未綁定", async () => {
    await updateSetting(handle.db, "employees.source", "leave-api", "t");
    vi.stubEnv("LEAVE_API_BASE_URL", "");
    vi.stubEnv("LEAVE_API_TOKEN", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await say("U1", "text", "參加 A1234")).toBe("系統忙碌，請稍後再試");
    warn.mockRestore();
    vi.unstubAllEnvs();
    const [p] = await handle.db
      .select()
      .from(participants)
      .where(eq(participants.lineUserId, "U1"));
    expect(p.status).toBe("pending_registration");
  });

  it("未通過查證者傳照片 → 提示先報名，不建立 submission", async () => {
    expect(await say("U1", "image")).toContain("請先完成報名");
    await say("U1", "text", "參加 NOPE");
    expect(await say("U1", "image")).toContain("請先完成報名");
    expect(await handle.db.select().from(submissions)).toHaveLength(0);
  });

  it("log 中不含編號以外的個資（不印 LINE userId、暱稱）", async () => {
    const spies = (["log", "warn", "error", "info"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    await updateSetting(handle.db, "employees.source", "leave-api", "t");
    vi.stubEnv("LEAVE_API_BASE_URL", "");
    await say("U-secret-id", "text", "參加 A1234");
    const printed = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(printed).not.toContain("U-secret-id");
    expect(printed).not.toContain("小明");
    spies.forEach((s) => s.mockRestore());
    vi.unstubAllEnvs();
  });
});
