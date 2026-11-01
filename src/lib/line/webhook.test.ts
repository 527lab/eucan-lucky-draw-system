import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbHandle } from "../db/client";
import { participants, webhookEvents } from "../db/schema";
import { createTestDb } from "../db/test-helper";
import { updateSetting } from "../settings";
import type { LineClient } from "./client";
import { parsePostbackData, postbackRoutes } from "./handlers/postback";
import { registrationHandler } from "./handlers/message";
import { computeSignature } from "./signature";
import { receiveWebhook, type WebhookDeps } from "./webhook";

const SECRET = "test-secret-not-real";
const USER = "Utest0001";
let seq = 0;

type Mock = LineClient & {
  replies: { token: string; messages: Array<Record<string, unknown>> }[];
  left: string[];
};

function mockClient(overrides: Partial<LineClient> = {}): Mock {
  const m = {
    replies: [] as Mock["replies"],
    left: [] as string[],
    async replyMessage(token: string, messages: unknown[]) {
      m.replies.push({ token, messages: messages as Array<Record<string, unknown>> });
    },
    async getProfile() {
      return { displayName: "小明", pictureUrl: "https://example.com/p.png" };
    },
    async leaveGroup(id: string) {
      m.left.push(`group:${id}`);
    },
    async leaveRoom(id: string) {
      m.left.push(`room:${id}`);
    },
    ...overrides,
  };
  return m as unknown as Mock;
}

function ev(type: string, extra: Record<string, unknown>, source: unknown = { type: "user", userId: USER }) {
  seq += 1;
  return {
    type,
    mode: "active",
    timestamp: 1_700_000_000_000 + seq,
    source,
    webhookEventId: `evt-${seq}`,
    deliveryContext: { isRedelivery: false },
    replyToken: `tok-${seq}`,
    ...extra,
  };
}
const text = (t: string, source?: unknown) =>
  ev("message", { message: { type: "text", id: `m${seq}`, text: t } }, source);

describe("LINE webhook", () => {
  let handle: DbHandle;
  let client: Mock;
  let pending: Promise<void>[];
  let deps: WebhookDeps;

  beforeEach(async () => {
    handle = await createTestDb();
    client = mockClient();
    pending = [];
    deps = {
      db: handle.db,
      client: () => client,
      channelSecret: SECRET,
      schedule: (task) => {
        pending.push(task());
      },
    };
  });
  afterEach(async () => {
    registrationHandler.current = null;
    for (const k of Object.keys(postbackRoutes)) delete postbackRoutes[k];
    await handle.close();
  });

  async function send(events: unknown[], opts: { signature?: string | null; raw?: string } = {}) {
    const raw = opts.raw ?? JSON.stringify({ destination: "Udest", events });
    const signature =
      opts.signature === undefined ? computeSignature(raw, SECRET) : opts.signature;
    const result = await receiveWebhook(raw, signature, deps);
    await Promise.all(pending);
    return result;
  }
  const count = async () => (await handle.db.select().from(webhookEvents)).length;
  const lastReplyText = () => {
    const r = client.replies.at(-1);
    return String(r?.messages[0]?.text ?? "");
  };

  describe("驗簽與去重", () => {
    it("簽章正確：回 200、寫入 webhook_events 並標為 processed", async () => {
      const res = await send([ev("follow", { follow: { isUnblocked: false } })]);
      expect(res.status).toBe(200);
      const rows = await handle.db.select().from(webhookEvents);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ type: "follow", lineUserId: USER, status: "processed" });
    });

    it("簽章錯誤回 401 且不寫入 DB、不呼叫 handler", async () => {
      const res = await send([text("說明")], { signature: "bad-signature" });
      expect(res.status).toBe(401);
      expect(await count()).toBe(0);
      expect(client.replies).toHaveLength(0);
    });

    it("缺少簽章回 401；secret 未設定回 500；簽章對但 JSON 壞掉回 400", async () => {
      expect((await send([text("說明")], { signature: null })).status).toBe(401);
      deps.channelSecret = undefined;
      expect((await send([text("說明")])).status).toBe(500);
      deps.channelSecret = SECRET;
      const raw = "{not json";
      expect((await send([], { raw, signature: computeSignature(raw, SECRET) })).status).toBe(400);
      expect(await count()).toBe(0);
    });

    it("events 為空（LINE Console Verify）回 200", async () => {
      expect((await send([])).status).toBe(200);
    });

    it("同一個 webhookEventId 送兩次只處理一次", async () => {
      const e = text("說明");
      await send([e]);
      const second = await send([{ ...e, deliveryContext: { isRedelivery: true } }]);
      expect(second.status).toBe(200);
      expect(second.body).toMatchObject({ received: 1, queued: 0 });
      expect(await count()).toBe(1);
      expect(client.replies).toHaveLength(1);
    });

    it("同一批次內重複的 id 也只處理一次", async () => {
      const e = text("說明");
      await send([e, e]);
      expect(client.replies).toHaveLength(1);
    });

    it("handler 丟錯：標為 failed 並記錄 error，其他事件照常處理", async () => {
      client = mockClient({
        replyMessage: async () => {
          throw new Error("reply boom");
        },
      });
      const bad = text("說明");
      const ok = ev("unfollow", {});
      await send([bad, ok]);
      const rows = await handle.db.select().from(webhookEvents);
      const byId = Object.fromEntries(rows.map((r) => [r.webhookEventId, r]));
      expect(byId[bad.webhookEventId].status).toBe("failed");
      expect(byId[bad.webhookEventId].error).toContain("reply boom");
      expect(byId[ok.webhookEventId].status).toBe("processed");
    });

    it("回應時間（不含 after）< 300ms", async () => {
      await send([text("說明")]); // 暖機
      const raw = JSON.stringify({ destination: "U", events: [text("說明")] });
      const started = performance.now();
      const res = await receiveWebhook(raw, computeSignature(raw, SECRET), deps);
      const elapsed = performance.now() - started;
      await Promise.all(pending);
      expect(res.status).toBe(200);
      expect(elapsed).toBeLessThan(300);
    });
  });

  describe("follow", () => {
    it("建立 pending_registration 參加者、回覆歡迎訊息、取得 profile", async () => {
      await send([ev("follow", { follow: { isUnblocked: false } })]);
      const [p] = await handle.db.select().from(participants);
      expect(p).toMatchObject({
        lineUserId: USER,
        status: "pending_registration",
        displayName: "小明",
        pictureUrl: "https://example.com/p.png",
      });
      expect(p.followedAt).toBeInstanceOf(Date);
      expect(lastReplyText()).toContain("參加");
      expect(lastReplyText()).toContain("EUCAN");
    });

    it("歡迎訊息使用後台設定的範本", async () => {
      await updateSetting(handle.db, "messages.welcome", "Hi {eventName}/{command}", "t");
      await send([ev("follow", {})]);
      expect(lastReplyText()).toBe("Hi EUCAN 2027 員工旅遊/參加");
    });

    it("getProfile 失敗仍會建立參加者並回覆", async () => {
      client = mockClient({
        getProfile: async () => {
          throw new Error("profile down");
        },
      });
      await send([ev("follow", {})]);
      const [p] = await handle.db.select().from(participants);
      expect(p.displayName).toBeNull();
      expect(client.replies).toHaveLength(1);
    });

    it("重新加入：已驗證者恢復 active、未驗證者回 pending、停權者維持 blocked", async () => {
      await handle.db.insert(participants).values([
        { lineUserId: "Ua", status: "unfollowed", employeeNo: "A1" },
        { lineUserId: "Ub", status: "unfollowed" },
        { lineUserId: "Uc", status: "blocked", employeeNo: null },
      ]);
      for (const u of ["Ua", "Ub", "Uc"]) {
        await send([ev("follow", {}, { type: "user", userId: u })]);
      }
      const rows = await handle.db.select().from(participants);
      const status = Object.fromEntries(rows.map((r) => [r.lineUserId, r.status]));
      expect(status).toEqual({ Ua: "active", Ub: "pending_registration", Uc: "blocked" });
      expect(rows).toHaveLength(3);
    });
  });

  describe("unfollow", () => {
    it("狀態改為 unfollowed，停權者不受影響", async () => {
      await handle.db.insert(participants).values([
        { lineUserId: "Ua", status: "active" },
        { lineUserId: "Ub", status: "blocked" },
      ]);
      await send([
        ev("unfollow", {}, { type: "user", userId: "Ua" }),
        ev("unfollow", {}, { type: "user", userId: "Ub" }),
      ]);
      const rows = await handle.db.select().from(participants);
      const status = Object.fromEntries(rows.map((r) => [r.lineUserId, r.status]));
      expect(status).toEqual({ Ua: "unfollowed", Ub: "blocked" });
    });
  });

  describe("message.text", () => {
    it("未報名者輸入「打卡」「進度」會被提示先報名", async () => {
      for (const kw of ["打卡", "進度"]) {
        client.replies.length = 0;
        await send([text(kw)]);
        expect(lastReplyText()).toContain("請先完成報名");
        expect(lastReplyText()).toContain("參加 A1234");
      }
      // 待報名者同樣被擋
      await handle.db.insert(participants).values({ lineUserId: USER });
      client.replies.length = 0;
      await send([text("打卡")]);
      expect(lastReplyText()).toContain("請先完成報名");
    });

    it("已報名者輸入「打卡」「進度」不會被要求報名（功能待 S4/S5）", async () => {
      await handle.db.insert(participants).values({ lineUserId: USER, status: "active" });
      await send([text("打卡")]);
      expect(lastReplyText()).not.toContain("請先完成報名");
      expect(lastReplyText()).toContain("尚未開放");
    });

    it("「說明」回覆後台設定的說明文字並附主選單", async () => {
      await updateSetting(handle.db, "messages.rules", "規則：拍照", "t");
      await send([text("說明")]);
      expect(lastReplyText()).toBe("規則：拍照");
      const qr = client.replies[0].messages[0].quickReply as { items: unknown[] };
      expect(qr.items).toHaveLength(3);
    });

    it("全形與前後空白的關鍵字也能辨識", async () => {
      await send([text("　說明　")]);
      expect(lastReplyText()).toContain("拍照");
    });

    it("無法辨識的文字回簡短說明加主選單", async () => {
      await send([text("你好")]);
      expect(lastReplyText()).toContain("關鍵字");
      expect(client.replies[0].messages[0].quickReply).toBeDefined();
    });

    it("報名指令：S3b 未註冊時回尚未開放；有註冊時交給它處理", async () => {
      await send([text("參加 A1234")]);
      expect(lastReplyText()).toContain("尚未開放");
      const spy = vi.fn<(c: unknown, e: unknown, t: string) => Promise<boolean>>(async () => true);
      registrationHandler.current = spy;
      client.replies.length = 0;
      await send([text("參加　Ａ１２３４")]);
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][2]).toBe("參加 A1234");
      expect(client.replies).toHaveLength(0);
    });
  });

  describe("其他訊息類型", () => {
    it("貼圖回「請傳照片喔」；圖片留待 S5 不回覆", async () => {
      await send([ev("message", { message: { type: "sticker", id: "s1", packageId: "1", stickerId: "1" } })]);
      expect(lastReplyText()).toBe("請傳照片喔");
      client.replies.length = 0;
      await send([ev("message", { message: { type: "image", id: "i1", contentProvider: { type: "line" } } })]);
      expect(lastReplyText()).toContain("請先完成報名");
    });
  });

  describe("postback", () => {
    it("依前綴分派到已註冊的路由；未知前綴只記錄不丟錯", async () => {
      const route = vi.fn(async () => {});
      postbackRoutes.spot = route;
      await send([ev("postback", { postback: { data: "spot:abc:1" } })]);
      expect(route).toHaveBeenCalledOnce();
      expect((route.mock.calls[0] as unknown[])[2]).toBe("abc:1");

      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await send([ev("postback", { postback: { data: "unknown:x" } })]);
      await send([ev("postback", { postback: { data: "constructor:x" } })]);
      warn.mockRestore();
      const rows = await handle.db.select().from(webhookEvents);
      expect(rows.every((r) => r.status === "processed")).toBe(true);
    });

    it("parsePostbackData", () => {
      expect(parsePostbackData("spot:1")).toEqual({ prefix: "spot", payload: "1" });
      expect(parsePostbackData("plain")).toEqual({ prefix: "plain", payload: "" });
    });
  });

  describe("群組事件", () => {
    it("被邀進群組／聊天室自動退出", async () => {
      await send([
        ev("join", {}, { type: "group", groupId: "G1" }),
        ev("join", {}, { type: "room", roomId: "R1" }),
      ]);
      expect(client.left).toEqual(["group:G1", "room:R1"]);
    });

    it("群組內的訊息不處理（不回覆、不建立參加者），leave 事件僅記錄", async () => {
      const group = { type: "group", groupId: "G1", userId: USER };
      await send([text("說明", group), ev("leave", {}, { type: "group", groupId: "G1" })]);
      expect(client.replies).toHaveLength(0);
      expect(await handle.db.select().from(participants)).toHaveLength(0);
      const rows = await handle.db
        .select()
        .from(webhookEvents)
        .where(eq(webhookEvents.status, "processed"));
      expect(rows).toHaveLength(2);
    });
  });
});
