import { createHmac, timingSafeEqual } from "node:crypto";

/** 後台 session：簽章 cookie 值（HMAC-SHA256），24 小時。時間由參數注入。 */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const SESSION_COOKIE_NAME = "admin_session";

export type AdminSession = {
  employeeNo: string;
  name: string;
  /** 緊急備援登入；稽核 actor 記為 break-glass。 */
  breakGlass: boolean;
  /** 到期時間（epoch ms）。 */
  exp: number;
};

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function createSessionToken(
  identity: { employeeNo: string; name: string; breakGlass?: boolean },
  secret: string,
  nowMs: number,
): string {
  const session: AdminSession = {
    employeeNo: identity.employeeNo,
    name: identity.name,
    breakGlass: identity.breakGlass === true,
    exp: nowMs + SESSION_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** 簽章錯誤、格式錯誤、過期都回 null。 */
export function verifySessionToken(
  token: string | undefined,
  secret: string,
  nowMs: number,
): AdminSession | null {
  if (!token || !secret) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || token.indexOf(".", dot + 1) !== -1) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), "base64url");
  const expected = Buffer.from(sign(body, secret), "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const s = parsed as Record<string, unknown>;
  if (
    typeof s.employeeNo !== "string" ||
    typeof s.name !== "string" ||
    typeof s.breakGlass !== "boolean" ||
    typeof s.exp !== "number" ||
    !(s.exp > nowMs)
  ) {
    return null;
  }
  return { employeeNo: s.employeeNo, name: s.name, breakGlass: s.breakGlass, exp: s.exp };
}

/** 稽核紀錄的 actor：「員工編號 姓名」；備援登入為 break-glass。 */
export function formatActor(
  session: Pick<AdminSession, "employeeNo" | "name" | "breakGlass">,
): string {
  return session.breakGlass ? "break-glass" : `${session.employeeNo} ${session.name}`.trim();
}
