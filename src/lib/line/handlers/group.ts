import type { HandlerContext, LineEvent } from "./types";

/** join：Bot 被邀進群組／多人聊天室就自動退出；leave：已被移出，無需動作（事件已記錄）。 */
export async function handleGroupEvent(ctx: HandlerContext, event: LineEvent) {
  if (event.type === "join") {
    const s = event.source;
    if (s?.type === "group") await ctx.client.leaveGroup(s.groupId);
    else if (s?.type === "room") await ctx.client.leaveRoom(s.roomId);
  }
}
