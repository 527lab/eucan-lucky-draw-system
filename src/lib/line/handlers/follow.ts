import { eq } from "drizzle-orm";
import { participants } from "../../db/schema";
import { getSettings } from "../../settings";
import { welcomeMessage } from "../messages";
import { findParticipant } from "./participants";
import { sourceUserId, type HandlerContext, type LineEvent } from "./types";

/** follow：建立或恢復參加者 → reply 歡迎訊息 → 取得 profile（失敗不影響流程）。 */
export async function handleFollow(ctx: HandlerContext, event: LineEvent) {
  if (event.type !== "follow") return;
  const userId = sourceUserId(event);
  if (!userId) return;
  const { db, client } = ctx;
  const now = ctx.now();

  const existing = await findParticipant(db, userId);
  if (!existing) {
    await db
      .insert(participants)
      .values({ lineUserId: userId, status: "pending_registration", followedAt: now })
      .onConflictDoNothing();
  } else {
    // 恢復：曾通過查證者回 active，否則回待報名；停權者維持停權。
    const status =
      existing.status === "unfollowed"
        ? existing.employeeNo
          ? "active"
          : "pending_registration"
        : existing.status;
    await db
      .update(participants)
      .set({ status, followedAt: now })
      .where(eq(participants.id, existing.id));
  }

  // 先回覆（reply token 有時效），再做非必要的 profile 查詢。
  const settings = await getSettings(db);
  if (event.replyToken) {
    await client.replyMessage(event.replyToken, [welcomeMessage(settings)]);
  }

  try {
    const profile = await client.getProfile(userId);
    await db
      .update(participants)
      .set({ displayName: profile.displayName, pictureUrl: profile.pictureUrl ?? null })
      .where(eq(participants.lineUserId, userId));
  } catch (err) {
    console.warn("[line] getProfile 失敗", { userId, error: String(err) });
  }
}
