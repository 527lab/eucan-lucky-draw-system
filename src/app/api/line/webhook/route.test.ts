import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbHandle } from "@/lib/db/client";
import { webhookEvents } from "@/lib/db/schema";
import { createTestDb } from "@/lib/db/test-helper";
import { computeSignature } from "@/lib/line/signature";

const SECRET = "test-secret-not-real";
let handle: DbHandle;

vi.mock("next/server", () => ({ after: (task: () => Promise<void>) => void task() }));
vi.mock("@/lib/db/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/db/client")>()),
  getDb: async () => handle.db,
}));
vi.mock("@/lib/line/client", () => ({
  getLineClient: () => ({
    replyMessage: async () => {},
    getProfile: async () => ({ displayName: "x" }),
    leaveGroup: async () => {},
    leaveRoom: async () => {},
  }),
}));

describe("POST /api/line/webhook", () => {
  beforeEach(async () => {
    handle = await createTestDb();
    vi.stubEnv("LINE_CHANNEL_SECRET", SECRET);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await handle.close();
  });

  const body = JSON.stringify({
    destination: "U",
    events: [
      {
        type: "unfollow",
        mode: "active",
        timestamp: 1,
        source: { type: "user", userId: "U1" },
        webhookEventId: "route-evt-1",
        deliveryContext: { isRedelivery: false },
      },
    ],
  });
  const post = async (signature: string) => {
    const { POST } = await import("./route");
    return POST(
      new Request("http://localhost/api/line/webhook", {
        method: "POST",
        headers: { "x-line-signature": signature },
        body,
      }),
    );
  };

  it("簽章正確回 200 並寫入事件", async () => {
    const res = await post(computeSignature(body, SECRET));
    expect(res.status).toBe(200);
    expect(await handle.db.select().from(webhookEvents)).toHaveLength(1);
  });

  it("簽章錯誤回 401 且不寫入", async () => {
    const res = await post("nope");
    expect(res.status).toBe(401);
    expect(await handle.db.select().from(webhookEvents)).toHaveLength(0);
  });
});
