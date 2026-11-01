import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbHandle } from "../db/client";
import {
  conversationStates,
  drawRuns,
  participants,
  spots,
  submissions,
  webhookEvents,
} from "../db/schema";
import { createTestDb } from "../db/test-helper";
import type { LineClient } from "../line/client";
import { computeSignature } from "../line/signature";
import { receiveWebhook } from "../line/webhook";
import { updateSetting } from "../settings";
import { MemoryPhotoStorage } from "../storage";
import { spotChoiceMessage } from "./messages";

const SECRET = "test-secret-not-real";
const USER = "Utest-upload-1";
const NOW = new Date("2027-05-10T04:00:00Z");
let seq = 0;

type Reply = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("S4 照片上傳流程", () => {
  let handle: DbHandle;
  let storage: MemoryPhotoStorage;
  let replies: Reply[][];
  let downloads: string[];
  let downloadError: Error | null;
  let now: Date;
  let spotA: string;
  let spotB: string;
  let pid: string;

  const client = (): LineClient =>
    ({
      async replyMessage(_t: string, messages: Reply[]) {
        replies.push(messages);
      },
      async getProfile() {
        return { displayName: "小明" };
      },
      async leaveGroup() {},
      async leaveRoom() {},
      async getMessageContent(id: string) {
        downloads.push(id);
        if (downloadError) throw downloadError;
        return { data: Buffer.from(`img-${id}`), contentType: "image/jpeg" };
      },
      async showLoading() {},
    }) as unknown as LineClient;

  async function send(message: Record<string, unknown> | null, extra: Record<string, unknown> = {}, user = USER) {
    seq += 1;
    const body = JSON.stringify({
      destination: "Ux",
      events: [
        {
          type: message ? "message" : "postback",
          mode: "active",
          timestamp: NOW.getTime() + seq,
          source: { type: "user", userId: user },
          webhookEventId: `evt-${seq}-${Math.random()}`,
          deliveryContext: { isRedelivery: false },
          replyToken: `rt-${seq}`,
          ...(message ? { message } : {}),
          ...extra,
        },
      ],
    });
    const pending: Promise<void>[] = [];
    await receiveWebhook(body, computeSignature(body, SECRET), {
      db: handle.db,
      client,
      storage: () => storage,
      channelSecret: SECRET,
      schedule: (t) => void pending.push(t()),
      now: () => now,
    });
    await Promise.all(pending);
    return replies.at(-1);
  }
  const text = (t: string) => send({ type: "text", id: `t${seq}`, text: t });
  const image = (id: string, imageSet?: { id: string; index: number; total: number }) =>
    send({ type: "image", id, contentProvider: { type: "line" }, ...(imageSet ? { imageSet } : {}) });
  const postback = (data: string) => send(null, { postback: { data } });
  const subs = () => handle.db.select().from(submissions);
  const replyText = (r?: Reply[]) => String(r?.[0]?.text ?? "");
  const quickData = (r?: Reply[]) =>
    (r?.[0]?.quickReply?.items as Reply[]).map((i) => i.action.data as string);

  beforeEach(async () => {
    handle = await createTestDb();
    storage = new MemoryPhotoStorage();
    replies = [];
    downloads = [];
    downloadError = null;
    now = NOW;
    const [p] = await handle.db
      .insert(participants)
      .values({ lineUserId: USER, status: "active", employeeNo: "A1234" })
      .returning();
    pid = p!.id;
    const rows = await handle.db
      .insert(spots)
      .values([
        { name: "日月潭", sortOrder: 1 },
        { name: "阿里山", sortOrder: 2 },
      ])
      .returning();
    spotA = rows[0]!.id;
    spotB = rows[1]!.id;
  });
  afterEach(async () => {
    await handle.close();
  });

  describe("路徑 A：先選景點再傳照片", () => {
    it("打卡 → 選景點 → 傳照片 → 自動通過並回覆券數", async () => {
      const menu = await text("打卡");
      expect(quickData(menu)).toEqual([`spot:${spotA}`, `spot:${spotB}`]);

      expect(JSON.stringify(await postback(`spot:${spotA}`))).toContain("日月潭");
      const [state] = await handle.db.select().from(conversationStates);
      expect(state).toMatchObject({ participantId: pid, spotId: spotA, state: "awaiting_photo" });

      const r = await image("img1");
      expect(replyText(r)).toBe("✅ 已收到「日月潭」景點照片，目前 1 張抽獎券");
      const [s] = await subs();
      expect(s).toMatchObject({
        participantId: pid,
        spotId: spotA,
        status: "approved",
        lineMessageId: "img1",
        contentType: "image/jpeg",
      });
      expect(s!.storageKey).toMatch(new RegExp(`^photos/${pid}/[0-9a-f-]{36}\\.jpg$`));
      expect(storage.files.get(s!.storageKey)?.data.toString()).toBe("img-img1");
      expect(await handle.db.select().from(conversationStates)).toHaveLength(0);
    });

    it("審核模式 manual：狀態為 pending_review，回覆「審核通過後計入」", async () => {
      await updateSetting(handle.db, "review.mode", "manual", "t");
      await postback(`spot:${spotA}`);
      expect(replyText(await image("img1"))).toContain("審核通過後計入");
      expect((await subs())[0]!.status).toBe("pending_review");
    });

    it("對話狀態逾時（TTL）後，照片走路徑 B", async () => {
      await postback(`spot:${spotA}`);
      now = new Date(NOW.getTime() + 11 * 60_000); // 預設 10 分鐘
      const r = await image("img1");
      expect(replyText(r)).toContain("哪個景點");
      expect((await subs())[0]).toMatchObject({ spotId: null, status: "pending_spot" });
    });

    it("一次傳 3 張（相同 imageSet）：選一次景點，3 張都綁定", async () => {
      await postback(`spot:${spotB}`);
      const set = (index: number) => ({ id: "set-1", index, total: 3 });
      await image("a1", set(1));
      await image("a2", set(2));
      await image("a3", set(3));
      const rows = await subs();
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.spotId === spotB && r.status === "approved")).toBe(true);
      expect(new Set(rows.map((r) => r.imageSetId))).toEqual(new Set(["set-1"]));
      // 下一組不同 imageSet 的照片不再套用同一個狀態
      const r = await image("b1", { id: "set-2", index: 1, total: 1 });
      expect(replyText(r)).toContain("哪個景點");
    });
  });

  describe("路徑 B：先傳照片再選景點", () => {
    it("傳照片 → 建立 pending_spot 並詢問 → 選景點後通過", async () => {
      const r = await image("img1");
      const [s] = await subs();
      expect(s).toMatchObject({ spotId: null, status: "pending_spot" });
      expect(quickData(r)).toEqual([`assign:${s!.id}:${spotA}`, `assign:${s!.id}:${spotB}`]);
      expect(storage.files.has(s!.storageKey)).toBe(true);

      const done = await postback(`assign:${s!.id}:${spotB}`);
      expect(replyText(done)).toBe("✅ 已收到「阿里山」景點照片，目前 1 張抽獎券");
      expect((await subs())[0]).toMatchObject({ spotId: spotB, status: "approved" });

      // 重複點同一個選項不會重複處理
      expect(replyText(await postback(`assign:${s!.id}:${spotA}`))).toContain("已經選過");
      expect((await subs())[0]!.spotId).toBe(spotB);
    });

    it("一次傳 3 張：只問一次，選一次景點後 3 張都綁定", async () => {
      const set = (index: number) => ({ id: "set-9", index, total: 3 });
      const r1 = await image("p1", set(1));
      const r2 = await image("p2", set(2));
      const r3 = await image("p3", set(3));
      // 只有最早的一張發問；其餘不回覆
      const asked = [r1, r2, r3].filter((r, i, arr) => i === 0 || r !== arr[i - 1]);
      expect(asked).toHaveLength(1);
      expect(replyText(r1)).toContain("哪個景點");
      const rows = await subs();
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.status === "pending_spot")).toBe(true);

      const first = rows.toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]!;
      await postback(`assign:${first.id}:${spotA}`);
      const after = await subs();
      expect(after.every((r) => r.spotId === spotA && r.status === "approved")).toBe(true);

      // 晚到的第 4 張同組照片直接沿用已選的景點
      await image("p4", set(4));
      expect((await subs()).find((r) => r.lineMessageId === "p4")).toMatchObject({
        spotId: spotA,
        status: "approved",
      });
    });

    it("只能替自己的照片選景點", async () => {
      await image("img1");
      const [s] = await subs();
      await handle.db.insert(participants).values({ lineUserId: "Uother", status: "active", employeeNo: "B1" });
      const r = await send(null, { postback: { data: `assign:${s!.id}:${spotA}` } }, "Uother");
      expect(replyText(r)).toContain("找不到");
      expect((await subs())[0]!.spotId).toBeNull();
    });
  });

  describe("限制與拒收", () => {
    it("超過截止時間：回覆提示、不建立 submission、不下載", async () => {
      await updateSetting(handle.db, "upload.deadlineAt", "2027-05-10T03:00:00Z", "t");
      expect(replyText(await image("img1"))).toContain("截止");
      expect(replyText(await text("打卡"))).toContain("截止");
      expect(replyText(await postback(`spot:${spotA}`))).toContain("截止");
      expect(await subs()).toHaveLength(0);
      expect(downloads).toHaveLength(0);
      expect(storage.files.size).toBe(0);
    });

    it("尚未開始上傳", async () => {
      await updateSetting(handle.db, "upload.startAt", "2027-05-11T00:00:00Z", "t");
      expect(replyText(await image("img1"))).toContain("尚未開始");
      expect(await subs()).toHaveLength(0);
    });

    it("景點未開放（時段外）：選單不列出，直接選／補選都被擋，不計入資格", async () => {
      await handle.db
        .update(spots)
        .set({ availableFrom: new Date("2027-05-11T00:00:00Z") })
        .where(eq(spots.id, spotA));
      expect(quickData(await text("打卡"))).toEqual([`spot:${spotB}`]);
      expect(replyText(await postback(`spot:${spotA}`))).toContain("不在開放時間");
      expect(await handle.db.select().from(conversationStates)).toHaveLength(0);

      await image("img1");
      const [s] = await subs();
      expect(replyText(await postback(`assign:${s!.id}:${spotA}`))).toContain("不在開放時間");
      expect((await subs())[0]).toMatchObject({ spotId: null, status: "pending_spot" });

      // 景點在 awaiting_photo 期間關閉
      await handle.db
        .update(spots)
        .set({ availableFrom: null, availableUntil: new Date("2027-05-10T05:00:00Z") })
        .where(eq(spots.id, spotA));
      await updateSetting(handle.db, "upload.pendingSpotTtlMinutes", 600, "t");
      await postback(`spot:${spotA}`);
      now = new Date("2027-05-10T06:00:00Z");
      expect(replyText(await image("img2"))).toContain("不在開放時間");
      expect(await subs()).toHaveLength(1);
    });

    it("沒有任何開放景點", async () => {
      await handle.db.update(spots).set({ active: false });
      expect(replyText(await text("打卡"))).toContain("沒有開放的景點");
      expect(replyText(await image("img1"))).toContain("沒有開放的景點");
    });

    it("抽獎已鎖定：拒收，且鎖定前未選景點的照片被補選時標為 rejected", async () => {
      await image("img1");
      const [s] = await subs();
      await handle.db.insert(drawRuns).values({ status: "locked" });
      expect(replyText(await image("img2"))).toContain("抽獎已經開始");
      expect(replyText(await text("打卡"))).toContain("抽獎已經開始");
      expect(await subs()).toHaveLength(1);

      expect(replyText(await postback(`assign:${s!.id}:${spotA}`))).toContain("抽獎已經開始");
      expect((await subs())[0]).toMatchObject({ status: "rejected", spotId: null });
    });

    it("upload.maxPerSpotPerUser：達上限後拒收（退件不佔名額）", async () => {
      await updateSetting(handle.db, "upload.maxPerSpotPerUser", 2, "t");
      for (const id of ["a", "b"]) {
        await postback(`spot:${spotA}`);
        await image(id);
      }
      await postback(`spot:${spotA}`);
      expect(replyText(await image("c"))).toContain("最多可上傳 2 張");
      expect(await subs()).toHaveLength(2);

      await handle.db.update(submissions).set({ status: "rejected" }).where(eq(submissions.lineMessageId, "a"));
      await postback(`spot:${spotA}`);
      expect(replyText(await image("c"))).toContain("已收到");
      expect(await subs()).toHaveLength(3);
    });

    it("同景點多張照片，抽獎券只算一次", async () => {
      for (const id of ["a", "b"]) {
        await postback(`spot:${spotA}`);
        await image(id);
      }
      await postback(`spot:${spotB}`);
      expect(replyText(await image("c"))).toContain("目前 2 張抽獎券");
    });

    it("未通過查證者與非 LINE 來源的圖片都不建立 submission", async () => {
      await handle.db.insert(participants).values({ lineUserId: "Unew" });
      const r = await send({ type: "image", id: "x1", contentProvider: { type: "line" } }, {}, "Unew");
      expect(replyText(r)).toContain("請先完成報名");

      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await send({ type: "image", id: "x2", contentProvider: { type: "external", originalContentUrl: "https://e/x.jpg", previewImageUrl: "https://e/p.jpg" } });
      warn.mockRestore();
      expect(await subs()).toHaveLength(0);
      expect(downloads).toHaveLength(0);
    });
  });

  describe("冪等與失敗處理", () => {
    it("同一張照片以不同事件 id 重送，不會產生第二筆 submission", async () => {
      await postback(`spot:${spotA}`);
      await image("dup1");
      await image("dup1"); // 新的 webhookEventId、相同 message id
      expect(await subs()).toHaveLength(1);
      expect(downloads).toEqual(["dup1"]);
      expect(storage.files.size).toBe(1);
    });

    it("同一張照片並發處理時，只留下一筆 submission 與一個檔案", async () => {
      await postback(`spot:${spotA}`);
      await Promise.all([image("race1"), image("race1")]);
      expect(await subs()).toHaveLength(1);
      expect(storage.files.size).toBe(1);
    });

    it("下載失敗：webhook_events 為 failed 並記錄 error，不建立 submission", async () => {
      downloadError = new Error("LINE content 404");
      await image("img1");
      const [ev] = await handle.db.select().from(webhookEvents).where(eq(webhookEvents.type, "message"));
      expect(ev).toMatchObject({ status: "failed" });
      expect(ev!.error).toContain("LINE content 404");
      expect(await subs()).toHaveLength(0);
    });

    it("儲存失敗：webhook_events 為 failed，不建立 submission，之後重送可成功", async () => {
      storage.failPut = true;
      await image("img1");
      const [ev] = await handle.db.select().from(webhookEvents);
      expect(ev).toMatchObject({ status: "failed" });
      expect(ev!.error).toContain("storage put failed");
      expect(await subs()).toHaveLength(0);

      storage.failPut = false;
      await image("img1");
      expect(await subs()).toHaveLength(1);
    });
  });

  describe("景點選單與進度", () => {
    it("景點超過 13 個改用 Flex carousel（Quick Reply 上限）", () => {
      const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `id${i}`, name: `景點${i}` }));
      const small = spotChoiceMessage("選", mk(13), (id) => `spot:${id}`);
      expect(small.type).toBe("text");
      const big = spotChoiceMessage("選", mk(14), (id) => `spot:${id}`) as unknown as Reply;
      expect(big.type).toBe("flex");
      expect(big.contents.type).toBe("carousel");
      const data = JSON.stringify(big.contents).match(/"data":"spot:id\d+"/g);
      expect(data).toHaveLength(14);
    });

    it("「進度」：完成 2 個景點顯示 2 個打勾", async () => {
      await updateSetting(handle.db, "upload.deadlineAt", "2027-05-20T10:00:00Z", "t");
      await handle.db.insert(spots).values({ name: "太魯閣", sortOrder: 3 });
      for (const sid of [spotA, spotB]) {
        await postback(`spot:${sid}`);
        await image(`p-${sid}`);
      }
      const r = await text("進度");
      expect(r?.[0]?.type).toBe("flex");
      const json = JSON.stringify(r![0]);
      expect(json.match(/✅/g)).toHaveLength(2);
      expect(json.match(/⬜/g)).toHaveLength(1);
      expect(json).toContain("已完成 2 / 3");
      expect(json).toContain("目前抽獎券：2 張");
      expect(json).toContain("上傳截止");
    });

    it("進度會顯示審核中的照片數", async () => {
      await updateSetting(handle.db, "review.mode", "manual", "t");
      await postback(`spot:${spotA}`);
      await image("m1");
      const json = JSON.stringify((await text("進度"))![0]);
      expect(json).not.toContain("✅");
      expect(json).toContain("照片：1 張");
    });
  });

  describe("暫時券數（S5 前）", () => {
    it("threshold / complete_all / maxPerUser", async () => {
      await updateSetting(handle.db, "ticket.mode", "complete_all", "t");
      await updateSetting(handle.db, "ticket.ticketsWhenComplete", 3, "t");
      await postback(`spot:${spotA}`);
      expect(replyText(await image("a"))).toContain("目前 0 張");
      await postback(`spot:${spotB}`);
      expect(replyText(await image("b"))).toContain("目前 3 張");
      await updateSetting(handle.db, "ticket.maxPerUser", 2, "t");
      await postback(`spot:${spotB}`);
      expect(replyText(await image("c"))).toContain("目前 2 張");
      await updateSetting(handle.db, "ticket.mode", "threshold", "t");
      await updateSetting(handle.db, "ticket.minSpots", 5, "t");
      await postback(`spot:${spotB}`);
      expect(replyText(await image("d"))).toContain("目前 0 張");
    });
  });
});
