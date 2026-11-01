import { describe, expect, it } from "vitest";
import { getDefaults } from "../settings/schema";
import {
  computeEntitlements,
  type EntAdjustment,
  type EntParticipant,
  type EntSpot,
  type EntSubmission,
  type EntitlementSettings,
} from "./entitlements";

const spot = (id: string, o: Partial<EntSpot> = {}): EntSpot => ({
  id, active: true, required: true, countsForTicket: true, ...o,
});
const SPOTS = [
  spot("s1"), spot("s2"), spot("s3"),
  spot("warm", { countsForTicket: false }),
  spot("opt", { required: false }),
];
const sub = (spotId: string | null, o: Partial<EntSubmission> = {}): EntSubmission => ({
  participantId: "p1", spotId, status: "approved", ...o,
});
const P = (status: EntParticipant["status"] = "active"): EntParticipant[] => [{ id: "p1", status }];
const cfg = (o: Partial<EntitlementSettings> = {}): EntitlementSettings => ({ ...getDefaults(), ...o });
const run = (
  s: EntitlementSettings,
  subs: EntSubmission[],
  opts: { spots?: EntSpot[]; adj?: EntAdjustment[]; ps?: EntParticipant[] } = {},
) => computeEntitlements(s, opts.ps ?? P(), subs, opts.spots ?? SPOTS, opts.adj ?? []).get("p1")!;

describe("computeEntitlements", () => {
  const modes = ["per_spot", "complete_all", "threshold"] as const;

  it.each(modes)("%s：沒有照片 → 0 張、不合格", (mode) => {
    expect(run(cfg({ "ticket.mode": mode }), [])).toEqual({ tickets: 0, completedSpotIds: [], eligible: false });
  });

  it("沒有傳入的參加者 → 空 Map；每位傳入者都有一筆", () => {
    expect(computeEntitlements(cfg(), [], [], SPOTS, []).size).toBe(0);
    expect(computeEntitlements(cfg(), [...P(), { id: "p2", status: "active" }], [], SPOTS, []).size).toBe(2);
  });

  describe("per_spot", () => {
    it("重複景點只算一次", () => {
      const r = run(cfg(), [sub("s1"), sub("s1"), sub("s2")]);
      expect(r.tickets).toBe(2);
      expect(r.completedSpotIds.sort()).toEqual(["s1", "s2"]);
      expect(r.eligible).toBe(true);
    });
    it("counts_for_ticket=false 不計券但出現在 completedSpotIds", () => {
      const r = run(cfg(), [sub("warm"), sub("s1")]);
      expect(r.tickets).toBe(1);
      expect(r.completedSpotIds).toContain("warm");
    });
    it("required=false 的景點仍計券", () => {
      expect(run(cfg(), [sub("opt")]).tickets).toBe(1);
    });
    it("maxPerUser 上限；null 不設上限", () => {
      const subs = [sub("s1"), sub("s2"), sub("s3")];
      expect(run(cfg({ "ticket.maxPerUser": 2 }), subs).tickets).toBe(2);
      expect(run(cfg({ "ticket.maxPerUser": null }), subs).tickets).toBe(3);
    });
    it("只計 approved；其他狀態、spotId=null、未知景點忽略", () => {
      const r = run(cfg(), [
        sub("s1", { status: "pending_review" }),
        sub("s2", { status: "rejected" }),
        sub(null),
        sub("ghost"),
        sub("s3"),
      ]);
      expect(r.tickets).toBe(1);
      expect(r.completedSpotIds).toEqual(["s3"]);
    });
    it("停用景點已通過的照片仍保留", () => {
      expect(run(cfg(), [sub("s1")], { spots: [spot("s1", { active: false })] }).tickets).toBe(1);
    });
  });

  describe("complete_all", () => {
    const c = cfg({ "ticket.mode": "complete_all", "ticket.ticketsWhenComplete": 3 });
    it("未完成全部必填 → 0；完成 → ticketsWhenComplete；暖身與選填不影響", () => {
      expect(run(c, [sub("s1"), sub("s2")]).tickets).toBe(0);
      expect(run(c, [sub("s1"), sub("s2"), sub("s3")]).tickets).toBe(3);
      expect(run(c, [sub("s1"), sub("s2"), sub("s3"), sub("opt"), sub("warm")]).tickets).toBe(3);
    });
    it("停用的必填景點不要求", () => {
      const spots = [spot("s1"), spot("s2", { active: false })];
      expect(run(c, [sub("s1")], { spots }).tickets).toBe(3);
    });
    it("沒有任何必填景點 → 0（避免空集合恆真）", () => {
      expect(run(c, [sub("opt")], { spots: [spot("opt", { required: false })] }).tickets).toBe(0);
    });
    it("maxPerUser 也限制固定券數", () => {
      expect(run({ ...c, "ticket.maxPerUser": 2 }, [sub("s1"), sub("s2"), sub("s3")]).tickets).toBe(2);
    });
  });

  describe("threshold", () => {
    const c = cfg({ "ticket.mode": "threshold", "ticket.minSpots": 2, "ticket.ticketsWhenComplete": 2 });
    it("達標才有；暖身景點不算入達標", () => {
      expect(run(c, [sub("s1")]).tickets).toBe(0);
      expect(run(c, [sub("s1"), sub("warm")]).tickets).toBe(0);
      expect(run(c, [sub("s1"), sub("opt")]).tickets).toBe(2);
    });
  });

  describe("手動調整", () => {
    it("正負加總並套在上限之後", () => {
      const adj = [
        { participantId: "p1", delta: 2 },
        { participantId: "p1", delta: -1 },
        { participantId: "p2", delta: 99 },
      ];
      expect(run(cfg({ "ticket.maxPerUser": 1 }), [sub("s1"), sub("s2")], { adj }).tickets).toBe(2);
    });
    it("負的調整使結果歸零且不為負", () => {
      const r = run(cfg(), [sub("s1")], { adj: [{ participantId: "p1", delta: -5 }] });
      expect(r.tickets).toBe(0);
      expect(r.eligible).toBe(false);
    });
    it("沒有照片但有正調整 → 合格", () => {
      expect(run(cfg(), [], { adj: [{ participantId: "p1", delta: 2 }] })).toMatchObject({
        tickets: 2, eligible: true,
      });
    });
  });

  describe("參加者狀態", () => {
    const subs = [sub("s1"), sub("s2")];
    const adj = [{ participantId: "p1", delta: 3 }];
    it("unfollowed + keepOnUnfollow=true → 保留", () => {
      expect(run(cfg({ "ticket.keepOnUnfollow": true }), subs, { ps: P("unfollowed") }).tickets).toBe(2);
    });
    it("unfollowed + keepOnUnfollow=false → 0，但仍列出已完成景點", () => {
      const r = run(cfg({ "ticket.keepOnUnfollow": false }), subs, { ps: P("unfollowed"), adj });
      expect(r).toEqual({ tickets: 0, completedSpotIds: ["s1", "s2"], eligible: false });
    });
    it.each(["blocked", "pending_registration"] as const)("%s → 一律 0（含手動調整）", (st) => {
      for (const mode of modes) {
        expect(run(cfg({ "ticket.mode": mode }), subs, { ps: P(st), adj })).toMatchObject({
          tickets: 0, eligible: false,
        });
      }
    });
  });

  it("多位參加者互不影響，且不修改輸入", () => {
    const ps: EntParticipant[] = [{ id: "p1", status: "active" }, { id: "p2", status: "active" }];
    const subs = [sub("s1"), sub("s2", { participantId: "p2" }), sub("s3", { participantId: "p2" })];
    const frozen = Object.freeze(subs.map((s) => Object.freeze(s)));
    const m = computeEntitlements(cfg(), ps, frozen, SPOTS, []);
    expect(m.get("p1")!.tickets).toBe(1);
    expect(m.get("p2")!.tickets).toBe(2);
  });
});
