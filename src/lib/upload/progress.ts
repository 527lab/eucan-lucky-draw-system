import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { messagingApi } from "@line/bot-sdk";
import type { Db } from "../db/client";
import { spots, submissions } from "../db/schema";
import type { LineMessage } from "../line/client";
import { mainMenuQuickReply } from "../line/messages";
import type { Settings } from "../settings";
import { formatTime } from "./rules";
import { provisionalTickets } from "./tickets-provisional";

/** 「進度」Flex Message：每個景點一列（✅／⬜），加上審核中張數、券數、截止時間。 */
export async function buildProgressMessage(
  db: Db,
  participantId: string,
  settings: Settings,
): Promise<LineMessage> {
  const allSpots = await db
    .select()
    .from(spots)
    .where(eq(spots.active, true))
    .orderBy(asc(spots.sortOrder), asc(spots.name));
  const approved = await db
    .selectDistinct({ spotId: submissions.spotId })
    .from(submissions)
    .where(and(eq(submissions.participantId, participantId), eq(submissions.status, "approved")));
  const done = new Set(approved.map((a) => a.spotId));
  const [{ pending }] = await db
    .select({ pending: count() })
    .from(submissions)
    .where(
      and(
        eq(submissions.participantId, participantId),
        inArray(submissions.status, ["pending_review", "pending_spot"]),
      ),
    );
  const tickets = await provisionalTickets(db, participantId, settings);
  const deadline = settings["upload.deadlineAt"];

  const row = (s: { name: string; required: boolean; id: string }): messagingApi.FlexComponent => ({
    type: "box",
    layout: "horizontal",
    contents: [
      { type: "text", text: done.has(s.id) ? "✅" : "⬜", flex: 0, size: "sm" },
      {
        type: "text",
        text: s.name + (s.required ? "" : "（選填）"),
        wrap: true,
        size: "sm",
        margin: "md",
      },
    ],
  });
  const note = (text: string): messagingApi.FlexComponent => ({
    type: "text",
    text,
    size: "xs",
    color: "#888888",
    wrap: true,
  });

  const completed = allSpots.filter((s) => done.has(s.id)).length;
  const bubble: messagingApi.FlexBubble = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        { type: "text", text: "📊 我的進度", weight: "bold", size: "lg" },
        { type: "text", text: `已完成 ${completed} / ${allSpots.length} 個景點`, size: "sm" },
        { type: "separator", margin: "md" },
        ...(allSpots.length > 0 ? allSpots.map(row) : [note("目前尚未設定景點")]),
        { type: "separator", margin: "md" },
        { type: "text", text: `🎟 目前抽獎券：${tickets} 張`, size: "sm", weight: "bold" },
        ...(pending > 0 ? [note(`審核／待選景點中的照片：${pending} 張`)] : []),
        ...(deadline ? [note(`上傳截止：${formatTime(deadline, settings["event.timezone"])}`)] : []),
      ],
    },
  };
  return {
    type: "flex",
    altText: `我的進度：已完成 ${completed}/${allSpots.length} 個景點，${tickets} 張抽獎券`,
    contents: bubble,
    quickReply: mainMenuQuickReply(),
  };
}
