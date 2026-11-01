import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** 資料模型：spec.md §6。時間一律 timestamptz；主鍵 uuid（gen_random_uuid()）。 */

const id = () => uuid("id").primaryKey().defaultRandom();
const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () =>
  ts("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const participantStatus = pgEnum("participant_status", [
  "pending_registration",
  "active",
  "blocked",
  "unfollowed",
]);
export const submissionStatus = pgEnum("submission_status", [
  "pending_spot",
  "pending_review",
  "approved",
  "rejected",
]);
export const conversationState = pgEnum("conversation_state", [
  "awaiting_photo",
]);
export const drawRunStatus = pgEnum("draw_run_status", [
  "locked",
  "drawn",
  "announced",
  "cancelled",
]);
export const drawResultStatus = pgEnum("draw_result_status", [
  "won",
  "void",
  "unfilled",
]);
export const outboundKind = pgEnum("outbound_kind", [
  "winner",
  "reject_notice",
  "announce",
  "other",
]);
export const outboundMethod = pgEnum("outbound_method", ["push", "multicast"]);
export const outboundStatus = pgEnum("outbound_status", [
  "pending",
  "sent",
  "failed",
]);
export const webhookStatus = pgEnum("webhook_status", [
  "received",
  "processed",
  "failed",
]);

export const participants = pgTable("participants", {
  id: id(),
  lineUserId: text("line_user_id").notNull().unique(),
  // 通過查證的員工編號；停權時釋出（設為 NULL）。PG 的 UNIQUE 允許多個 NULL。
  employeeNo: text("employee_no").unique(),
  employeeVerifiedAt: ts("employee_verified_at"),
  displayName: text("display_name"),
  pictureUrl: text("picture_url"),
  status: participantStatus("status").notNull().default("pending_registration"),
  registeredAt: ts("registered_at"),
  followedAt: ts("followed_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const spots = pgTable("spots", {
  id: id(),
  name: text("name").notNull(),
  description: text("description"),
  hintImageUrl: text("hint_image_url"),
  latitude: numeric("latitude"),
  longitude: numeric("longitude"),
  sortOrder: integer("sort_order").notNull().default(0),
  required: boolean("required").notNull().default(true),
  countsForTicket: boolean("counts_for_ticket").notNull().default(true),
  availableFrom: ts("available_from"),
  availableUntil: ts("available_until"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const submissions = pgTable(
  "submissions",
  {
    id: id(),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id),
    spotId: uuid("spot_id").references(() => spots.id), // null = pending_spot
    lineMessageId: text("line_message_id").notNull().unique(), // 冪等鍵
    imageSetId: text("image_set_id"),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type"),
    sizeBytes: integer("size_bytes"),
    status: submissionStatus("status").notNull(),
    rejectReason: text("reject_reason"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: ts("reviewed_at"),
    createdAt: createdAt(), // 以 LINE webhook 的 timestamp 為準（由應用程式寫入）
  },
  (t) => [
    index("submissions_participant_spot_status_idx").on(
      t.participantId,
      t.spotId,
      t.status,
    ),
  ],
);

// 僅 employees.source=csv 時使用（備援）；只存編號
export const employeeAllowlist = pgTable("employee_allowlist", {
  employeeNo: text("employee_no").primaryKey(),
  importedAt: ts("imported_at").notNull().defaultNow(),
});

export const conversationStates = pgTable("conversation_states", {
  participantId: uuid("participant_id")
    .primaryKey()
    .references(() => participants.id),
  state: conversationState("state").notNull(),
  spotId: uuid("spot_id").references(() => spots.id),
  imageSetId: text("image_set_id"),
  expiresAt: ts("expires_at").notNull(),
});

export const ticketAdjustments = pgTable("ticket_adjustments", {
  id: id(),
  participantId: uuid("participant_id")
    .notNull()
    .references(() => participants.id),
  delta: integer("delta").notNull(),
  reason: text("reason").notNull(),
  createdBy: text("created_by"),
  createdAt: createdAt(),
});

export const prizes = pgTable(
  "prizes",
  {
    id: id(),
    name: text("name").notNull(),
    description: text("description"),
    imageUrl: text("image_url"),
    quantity: integer("quantity").notNull(),
    drawOrder: integer("draw_order").notNull(), // 小的先抽
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("prizes_quantity_positive", sql`${t.quantity} > 0`)],
);

export const drawRuns = pgTable(
  "draw_runs",
  {
    id: id(),
    status: drawRunStatus("status").notNull(),
    settingsSnapshot: jsonb("settings_snapshot"),
    poolSnapshot: jsonb("pool_snapshot"), // [{participantId, tickets}]
    triggeredBy: text("triggered_by"),
    lockedAt: ts("locked_at"),
    drawnAt: ts("drawn_at"),
    announcedAt: ts("announced_at"),
  },
  (t) => [
    // 同時間只能有一筆非 cancelled 的 run
    uniqueIndex("draw_runs_single_active_idx")
      .on(sql`(true)`)
      .where(sql`${t.status} <> 'cancelled'`),
  ],
);

export const drawResults = pgTable("draw_results", {
  id: id(),
  drawRunId: uuid("draw_run_id")
    .notNull()
    .references(() => drawRuns.id),
  prizeId: uuid("prize_id")
    .notNull()
    .references(() => prizes.id),
  slot: integer("slot").notNull(),
  participantId: uuid("participant_id").references(() => participants.id), // unfilled 為 null
  status: drawResultStatus("status").notNull(),
  randomValue: bigint("random_value", { mode: "bigint" }),
  replacesResultId: uuid("replaces_result_id").references(
    (): AnyPgColumn => drawResults.id,
  ),
  revealedAt: ts("revealed_at"),
  createdAt: createdAt(),
});

export const outboundMessages = pgTable("outbound_messages", {
  id: id(),
  participantId: uuid("participant_id").references(() => participants.id),
  kind: outboundKind("kind").notNull(),
  method: outboundMethod("method").notNull(),
  retryKey: uuid("retry_key").notNull().unique(),
  status: outboundStatus("status").notNull().default("pending"),
  lineRequestId: text("line_request_id"),
  error: text("error"),
  relatedId: uuid("related_id"), // 例如 draw_result_id
  createdAt: createdAt(),
  sentAt: ts("sent_at"),
});

export const webhookEvents = pgTable("webhook_events", {
  webhookEventId: text("webhook_event_id").primaryKey(), // LINE 提供，用於去重
  type: text("type"),
  lineUserId: text("line_user_id"),
  isRedelivery: boolean("is_redelivery").notNull().default(false),
  status: webhookStatus("status").notNull().default("received"),
  error: text("error"),
  payload: jsonb("payload"),
  receivedAt: ts("received_at").notNull().defaultNow(),
  processedAt: ts("processed_at"),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value"),
  updatedBy: text("updated_by"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const adminAuditLogs = pgTable("admin_audit_logs", {
  id: id(),
  actor: text("actor").notNull(), // 「員工編號 姓名」
  action: text("action").notNull(), // e.g. submission.approve
  targetType: text("target_type"),
  targetId: text("target_id"),
  payload: jsonb("payload"),
  createdAt: createdAt(),
});
