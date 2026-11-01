import { assignRoute, spotRoute } from "../../upload";
import { sourceUserId, type HandlerContext, type LineEvent } from "./types";

export type PostbackRoute = (
  ctx: HandlerContext,
  event: Extract<LineEvent, { type: "postback" }>,
  payload: string,
) => Promise<void>;

/** postback data 形如 `<prefix>:<payload>`（例如 `spot:<spotId>`）；後續階段在此註冊路由。 */
export const postbackRoutes: Record<string, PostbackRoute> = {
  spot: spotRoute,
  assign: assignRoute,
};

export function parsePostbackData(data: string): { prefix: string; payload: string } {
  const i = data.indexOf(":");
  return i < 0
    ? { prefix: data, payload: "" }
    : { prefix: data.slice(0, i), payload: data.slice(i + 1) };
}

export async function handlePostback(ctx: HandlerContext, event: LineEvent) {
  if (event.type !== "postback") return;
  if (!sourceUserId(event)) return;
  const { prefix, payload } = parsePostbackData(event.postback.data);
  const route = Object.hasOwn(postbackRoutes, prefix) ? postbackRoutes[prefix] : undefined;
  if (!route) {
    console.warn("[line] 未知的 postback", { prefix });
    return;
  }
  await route(ctx, event, payload);
}
