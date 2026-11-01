import { and, asc, count, eq, gt, inArray, ne, notInArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { conversationStates, spots, submissions } from "../db/schema";
import { findParticipant, isActive } from "../line/handlers/participants";
import type { HandlerContext, LineEvent } from "../line/handlers/types";
import { notRegisteredMessage } from "../line/messages";
import { getSettings, type Settings } from "../settings";
import { newPhotoKey } from "../storage";
import {
  assignNotFoundMessage,
  blockedMessage,
  chooseSpotPrompt,
  noOpenSpotsMessage,
  photoAlreadyAssignedMessage,
  photoApprovedMessage,
  photoPendingReviewMessage,
  sendPhotoMessage,
  spotChoiceMessage,
  spotClosedMessage,
  spotLimitMessage,
  whichSpotPrompt,
} from "./messages";
import { buildProgressMessage } from "./progress";
import { checkUploadWindow, isSpotOpen } from "./rules";
import { ticketsFor } from "../domain/entitlements-db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type MessageEvent = Extract<LineEvent, { type: "message" }>;
type PostbackEvent = Extract<LineEvent, { type: "postback" }>;

async function openSpots(db: Db, now: Date) {
  const rows = await db
    .select()
    .from(spots)
    .where(eq(spots.active, true))
    .orderBy(asc(spots.sortOrder), asc(spots.name));
  return rows.filter((s) => isSpotOpen(s, now));
}

async function getSpot(db: Db, id: string) {
  if (!UUID_RE.test(id)) return undefined;
  const [row] = await db.select().from(spots).where(eq(spots.id, id));
  return row;
}

/** 該參加者在景點已佔用名額的照片數（不含被退件的、不含 excludeIds）。 */
async function usedAtSpot(db: Db, participantId: string, spotId: string, excludeIds: string[] = []) {
  const conds = [
    eq(submissions.participantId, participantId),
    eq(submissions.spotId, spotId),
    ne(submissions.status, "rejected"),
  ];
  if (excludeIds.length > 0) conds.push(notInArray(submissions.id, excludeIds));
  const [{ n }] = await db
    .select({ n: count() })
    .from(submissions)
    .where(and(...conds));
  return n;
}

const statusFor = (s: Settings) => (s["review.mode"] === "auto" ? "approved" : "pending_review");

function userIdOf(event: LineEvent): string | undefined {
  return event.source?.type === "user" ? event.source.userId : undefined;
}

async function approvedOrPendingReply(
  ctx: HandlerContext,
  participantId: string,
  settings: Settings,
  status: "approved" | "pending_review",
  spotName: string,
) {
  return status === "approved"
    ? photoApprovedMessage(spotName, await ticketsFor(ctx.db, settings, participantId))
    : photoPendingReviewMessage();
}

/** 「打卡」：列出目前開放的景點。呼叫端已確認為 active 參加者。 */
export async function handleCheckin(ctx: HandlerContext, event: MessageEvent, settings: Settings) {
  const { db, client } = ctx;
  const replyToken = event.replyToken;
  if (!replyToken) return;
  const block = await checkUploadWindow(db, settings, ctx.now());
  if (block) {
    await client.replyMessage(replyToken, [blockedMessage(block, settings)]);
    return;
  }
  const open = await openSpots(db, ctx.now());
  await client.replyMessage(
    replyToken,
    open.length === 0
      ? [noOpenSpotsMessage()]
      : [spotChoiceMessage(chooseSpotPrompt(), open, (id) => `spot:${id}`)],
  );
}

export async function handleProgress(
  ctx: HandlerContext,
  event: MessageEvent,
  participantId: string,
  settings: Settings,
) {
  if (!event.replyToken) return;
  const msg = await buildProgressMessage(ctx.db, participantId, settings);
  await ctx.client.replyMessage(event.replyToken, [msg]);
}

/** postback `spot:<spotId>`：寫入 awaiting_photo 並請使用者傳照片（路徑 A）。 */
export async function spotRoute(ctx: HandlerContext, event: PostbackEvent, payload: string) {
  const { db, client } = ctx;
  const userId = userIdOf(event);
  const replyToken = event.replyToken;
  if (!userId || !replyToken) return;
  const settings = await getSettings(db);
  const participant = await findParticipant(db, userId);
  if (!participant || !isActive(participant)) {
    await client.replyMessage(replyToken, [notRegisteredMessage(settings)]);
    return;
  }
  const now = ctx.now();
  const block = await checkUploadWindow(db, settings, now);
  if (block) {
    await client.replyMessage(replyToken, [blockedMessage(block, settings)]);
    return;
  }
  const spot = await getSpot(db, payload);
  if (!spot) return;
  if (!isSpotOpen(spot, now)) {
    await client.replyMessage(replyToken, [spotClosedMessage(spot.name)]);
    return;
  }
  const expiresAt = new Date(now.getTime() + settings["upload.pendingSpotTtlMinutes"] * 60_000);
  await db
    .insert(conversationStates)
    .values({ participantId: participant.id, state: "awaiting_photo", spotId: spot.id, expiresAt })
    .onConflictDoUpdate({
      target: conversationStates.participantId,
      set: { state: "awaiting_photo", spotId: spot.id, imageSetId: null, expiresAt },
    });
  await client.replyMessage(replyToken, [sendPhotoMessage(spot.name)]);
}

/** postback `assign:<submissionId>:<spotId>`：替 pending_spot 的照片（整組）補上景點（路徑 B）。 */
export async function assignRoute(ctx: HandlerContext, event: PostbackEvent, payload: string) {
  const { db, client } = ctx;
  const userId = userIdOf(event);
  const replyToken = event.replyToken;
  if (!userId || !replyToken) return;
  const settings = await getSettings(db);
  const participant = await findParticipant(db, userId);
  if (!participant || !isActive(participant)) {
    await client.replyMessage(replyToken, [notRegisteredMessage(settings)]);
    return;
  }

  const [subId = "", spotId = ""] = payload.split(":");
  if (!UUID_RE.test(subId) || !UUID_RE.test(spotId)) return;
  const [sub] = await db
    .select()
    .from(submissions)
    .where(and(eq(submissions.id, subId), eq(submissions.participantId, participant.id)));
  if (!sub) {
    await client.replyMessage(replyToken, [assignNotFoundMessage()]);
    return;
  }
  if (sub.spotId || sub.status !== "pending_spot") {
    await client.replyMessage(replyToken, [photoAlreadyAssignedMessage()]);
    return;
  }

  const now = ctx.now();
  const targets = sub.imageSetId
    ? await db
        .select({ id: submissions.id })
        .from(submissions)
        .where(
          and(
            eq(submissions.participantId, participant.id),
            eq(submissions.imageSetId, sub.imageSetId),
            eq(submissions.status, "pending_spot"),
          ),
        )
    : [{ id: sub.id }];
  const targetIds = targets.map((t) => t.id);

  const block = await checkUploadWindow(db, settings, now);
  if (block) {
    if (block !== "not_started") {
      await db
        .update(submissions)
        .set({ status: "rejected", rejectReason: block, reviewedBy: "system", reviewedAt: now })
        .where(inArray(submissions.id, targetIds));
    }
    await client.replyMessage(replyToken, [blockedMessage(block, settings)]);
    return;
  }
  const spot = await getSpot(db, spotId);
  if (!spot) return;
  if (!isSpotOpen(spot, now)) {
    await client.replyMessage(replyToken, [spotClosedMessage(spot.name)]);
    return;
  }
  const max = settings["upload.maxPerSpotPerUser"];
  if ((await usedAtSpot(db, participant.id, spot.id, targetIds)) + targetIds.length > max) {
    await client.replyMessage(replyToken, [spotLimitMessage(spot.name, max)]);
    return;
  }

  const status = statusFor(settings);
  await db
    .update(submissions)
    .set({ spotId: spot.id, status })
    .where(and(inArray(submissions.id, targetIds), eq(submissions.status, "pending_spot")));
  await client.replyMessage(replyToken, [
    await approvedOrPendingReply(ctx, participant.id, settings, status, spot.name),
  ]);
}

/** message.image：先下載再存 storage，之後建立 submission（spec §3.2 路徑 A／B）。 */
export async function handleImage(ctx: HandlerContext, event: MessageEvent) {
  const message = event.message;
  if (message.type !== "image") return;
  const userId = userIdOf(event);
  const replyToken = event.replyToken;
  if (!userId || !replyToken) return;
  const { db, client } = ctx;
  const settings = await getSettings(db);
  const participant = await findParticipant(db, userId);
  if (!participant || !isActive(participant)) {
    await client.replyMessage(replyToken, [notRegisteredMessage(settings)]);
    return;
  }

  const [dup] = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.lineMessageId, message.id));
  if (dup) return; // 同一張照片重送

  const now = ctx.now();
  const block = await checkUploadWindow(db, settings, now);
  if (block) {
    await client.replyMessage(replyToken, [blockedMessage(block, settings)]);
    return;
  }

  if (message.contentProvider.type !== "line") {
    console.warn("[line] 圖片來源不是 LINE，略過", { type: message.contentProvider.type });
    return;
  }

  const imageSetId = message.imageSet?.id ?? null;

  // 決定景點：同組已有景點 > 有效的 awaiting_photo 狀態 > 無（pending_spot）
  let spotId: string | null = null;
  let usedState = false;
  if (imageSetId) {
    const siblings = await db
      .select({ spotId: submissions.spotId })
      .from(submissions)
      .where(
        and(eq(submissions.participantId, participant.id), eq(submissions.imageSetId, imageSetId)),
      );
    spotId = siblings.find((s) => s.spotId)?.spotId ?? null;
  }
  if (!spotId) {
    const [state] = await db
      .select()
      .from(conversationStates)
      .where(
        and(
          eq(conversationStates.participantId, participant.id),
          gt(conversationStates.expiresAt, now),
        ),
      );
    if (state?.spotId) {
      if (state.imageSetId && state.imageSetId !== imageSetId) {
        // 狀態已被前一組照片使用完畢，這張視為沒有景點
        await db
          .delete(conversationStates)
          .where(eq(conversationStates.participantId, participant.id));
      } else {
        spotId = state.spotId;
        usedState = true;
      }
    }
  }

  let spot: Awaited<ReturnType<typeof getSpot>>;
  if (spotId) {
    spot = await getSpot(db, spotId);
    if (!spot || !isSpotOpen(spot, now)) {
      await db
        .delete(conversationStates)
        .where(eq(conversationStates.participantId, participant.id));
      await client.replyMessage(replyToken, [spotClosedMessage(spot?.name ?? "此景點")]);
      return;
    }
    const max = settings["upload.maxPerSpotPerUser"];
    if ((await usedAtSpot(db, participant.id, spot.id)) >= max) {
      await client.replyMessage(replyToken, [spotLimitMessage(spot.name, max)]);
      return;
    }
  }

  // 立刻下載並保存（LINE 內容會過期）；任何失敗都丟出，由 webhook 層記為 failed。
  await client.showLoading(userId, 5).catch(() => {});
  const content = await client.getMessageContent(message.id);
  const storageKey = newPhotoKey(participant.id);
  const storage = ctx.storage();
  await storage.put(storageKey, content.data, content.contentType);

  const status = spot ? statusFor(settings) : "pending_spot";
  let inserted: { id: string }[];
  try {
    inserted = await db
      .insert(submissions)
      .values({
        participantId: participant.id,
        spotId: spot?.id ?? null,
        lineMessageId: message.id,
        imageSetId,
        storageKey,
        contentType: content.contentType,
        sizeBytes: content.data.length,
        status,
        createdAt: new Date(event.timestamp),
      })
      .onConflictDoNothing({ target: submissions.lineMessageId })
      .returning({ id: submissions.id });
  } catch (err) {
    await storage.delete(storageKey).catch(() => {});
    throw err;
  }
  const submissionId = inserted[0]?.id;
  if (!submissionId) {
    await storage.delete(storageKey).catch(() => {}); // 並發的重送已建立 submission
    return;
  }

  if (usedState) {
    if (imageSetId) {
      await db
        .update(conversationStates)
        .set({ imageSetId })
        .where(eq(conversationStates.participantId, participant.id));
    } else {
      await db
        .delete(conversationStates)
        .where(eq(conversationStates.participantId, participant.id));
    }
  }

  if (spot && status !== "pending_spot") {
    await client.replyMessage(replyToken, [
      await approvedOrPendingReply(ctx, participant.id, settings, status, spot.name),
    ]);
    return;
  }

  // 路徑 B：同一組只由「最早的」那張發問，避免重複詢問。
  if (imageSetId) {
    const [first] = await db
      .select({ id: submissions.id })
      .from(submissions)
      .where(
        and(
          eq(submissions.participantId, participant.id),
          eq(submissions.imageSetId, imageSetId),
          eq(submissions.status, "pending_spot"),
        ),
      )
      .orderBy(asc(submissions.createdAt), asc(submissions.id));
    if (first && first.id !== submissionId) return;
  }
  const open = await openSpots(db, now);
  await client.replyMessage(
    replyToken,
    open.length === 0
      ? [noOpenSpotsMessage()]
      : [spotChoiceMessage(whichSpotPrompt(), open, (id) => `assign:${submissionId}:${id}`)],
  );
}
