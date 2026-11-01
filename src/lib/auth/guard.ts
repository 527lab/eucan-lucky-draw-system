import { verifySessionToken } from "./session";

export const LOGIN_PATH = "/admin/login";

export type GuardDecision = "allow" | "redirect-login" | "unauthorized";

/** 是否屬於需要保護的後台路徑（/admin、/admin/**、/api/admin/**）。 */
export function isAdminPath(pathname: string): boolean {
  return /^\/(api\/)?admin(\/|$)/.test(pathname);
}

/**
 * 後台存取判斷（proxy 與測試共用）：登入頁放行；其餘需有效 session cookie。
 * 頁面導向登入頁，API 回 401。SESSION_SECRET 未設定時一律視為未登入。
 */
export function decideAdminAccess(
  pathname: string,
  cookieValue: string | undefined,
  secret: string | undefined,
  nowMs: number,
): GuardDecision {
  if (!isAdminPath(pathname)) return "allow";
  if (pathname === LOGIN_PATH || pathname === `${LOGIN_PATH}/`) return "allow";
  const ok = !!secret && verifySessionToken(cookieValue, secret, nowMs) !== null;
  if (ok) return "allow";
  return pathname.startsWith("/api/") ? "unauthorized" : "redirect-login";
}
