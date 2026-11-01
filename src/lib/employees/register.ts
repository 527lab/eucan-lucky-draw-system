import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { participants } from "../db/schema";
import { getSettings } from "../settings";
import { registrationHandler } from "../line/handlers/message";
import { findParticipant } from "../line/handlers/participants";
import { sourceUserId, type HandlerContext, type LineEvent } from "../line/handlers/types";
import {
  alreadyRegisteredMessage,
  employeeNoTakenMessage,
  invalidEmployeeNoMessage,
  registrationBlockedMessage,
  registrationSuccessMessage,
  registrationUsageMessage,
  verifierBusyMessage,
} from "../line/messages";
import { createVerifier } from "./factory";
import { parseRegistration } from "./register-parse";
import { VerifierUnavailableError, type EmployeeVerifier } from "./verifier";

export { parseRegistration } from "./register-parse";

export type RegisterOutcome = "success" | "invalid" | "taken" | "busy" | "already" | "blocked";

function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; e && i < 5; i++) {
    if (typeof e === "object" && (e as { code?: unknown }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * 查證並綁定編號。並發安全靠 participants.employee_no 的 UNIQUE：
 * 兩個帳號搶同一編號時，只有一個 UPDATE 成功，另一個收到 taken。
 */
export async function registerEmployee(
  db: Db,
  lineUserId: string,
  employeeNo: string | null,
  verifier: EmployeeVerifier,
  now: Date,
): Promise<RegisterOutcome> {
  await db.insert(participants).values({ lineUserId, followedAt: now }).onConflictDoNothing();
  const me = await findParticipant(db, lineUserId);
  if (!me) throw new Error("participant missing after insert");
  if (me.status === "blocked") return "blocked";
  if (me.status === "active") {
    if (employeeNo !== null && me.employeeNo === employeeNo) return "success"; // 重複輸入視為成功
    return "already";
  }
  if (employeeNo === null) return "invalid";

  let valid: boolean;
  try {
    ({ valid } = await verifier.verify(employeeNo));
  } catch (err) {
    if (err instanceof VerifierUnavailableError) {
      console.warn("[register] 查證服務無法使用", { reason: err.message });
      return "busy";
    }
    throw err;
  }
  if (!valid) return "invalid";

  try {
    const updated = await db
      .update(participants)
      .set({ employeeNo, employeeVerifiedAt: now, status: "active", registeredAt: now })
      .where(eq(participants.id, me.id))
      .returning({ id: participants.id });
    return updated.length === 0 ? "already" : "success";
  } catch (err) {
    if (isUniqueViolation(err)) return "taken";
    throw err;
  }
}

/** 掛在 registrationHandler.current 的處理函式（text 已 NFKC＋trim）。回 true 表示已回覆。 */
export async function handleRegistration(
  ctx: HandlerContext,
  event: LineEvent,
  text: string,
  verifierOverride?: EmployeeVerifier,
): Promise<boolean> {
  const userId = sourceUserId(event);
  const replyToken = event.type === "message" ? event.replyToken : undefined;
  if (!userId || !replyToken) return false;

  const settings = await getSettings(ctx.db);
  const parsed = parseRegistration(text, settings["registration.command"]);
  if (parsed.kind === "none") return false;
  if (parsed.kind === "usage") {
    await ctx.client.replyMessage(replyToken, [registrationUsageMessage(settings)]);
    return true;
  }

  const verifier = verifierOverride ?? createVerifier(ctx.db, settings);
  const outcome = await registerEmployee(ctx.db, userId, parsed.employeeNo, verifier, ctx.now());
  const reply = {
    success: () => registrationSuccessMessage(settings),
    invalid: invalidEmployeeNoMessage,
    taken: employeeNoTakenMessage,
    busy: verifierBusyMessage,
    already: alreadyRegisteredMessage,
    blocked: registrationBlockedMessage,
  }[outcome]();
  await ctx.client.replyMessage(replyToken, [reply]);
  return true;
}

/** 啟動時呼叫一次，把報名處理掛到 message handler。 */
export function installRegistrationHandler() {
  registrationHandler.current = (ctx, event, text) => handleRegistration(ctx, event, text);
}
