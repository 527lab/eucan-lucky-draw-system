import { handleFollow } from "./follow";
import { handleGroupEvent } from "./group";
import { handleMessage } from "./message";
import { handlePostback } from "./postback";
import { handleUnfollow } from "./unfollow";
import type { HandlerContext, LineEvent } from "./types";

export type { HandlerContext, LineEvent } from "./types";

/** 依事件類型分派；不認得的類型直接略過（仍已記錄在 webhook_events）。 */
export async function dispatchEvent(ctx: HandlerContext, event: LineEvent) {
  switch (event.type) {
    case "follow":
      return handleFollow(ctx, event);
    case "unfollow":
      return handleUnfollow(ctx, event);
    case "message":
      return handleMessage(ctx, event);
    case "postback":
      return handlePostback(ctx, event);
    case "join":
    case "leave":
      return handleGroupEvent(ctx, event);
    default:
      return;
  }
}
