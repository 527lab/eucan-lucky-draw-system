import { and, eq, ne } from "drizzle-orm";
import { participants } from "../../db/schema";
import { sourceUserId, type HandlerContext, type LineEvent } from "./types";

/** unfollow：狀態改為 unfollowed（停權者維持停權）。抽獎資格是否保留由 ticket.keepOnUnfollow 在算券時決定。 */
export async function handleUnfollow(ctx: HandlerContext, event: LineEvent) {
  if (event.type !== "unfollow") return;
  const userId = sourceUserId(event);
  if (!userId) return;
  await ctx.db
    .update(participants)
    .set({ status: "unfollowed" })
    .where(and(eq(participants.lineUserId, userId), ne(participants.status, "blocked")));
}
