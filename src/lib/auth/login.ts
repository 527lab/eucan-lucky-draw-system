import type { Db } from "../db/client";
import { loginAdmin, type AdminAuthenticator } from "./admin-authenticator";
import { auditLogin } from "./audit";
import type { LoginRateLimiter } from "./rate-limit";
import { createSessionToken, formatActor } from "./session";

export type LoginOutcome =
  | { status: "ok"; token: string }
  | { status: "invalid" }
  | { status: "unavailable" }
  | { status: "rate-limited"; retryAfterSeconds: number }
  | { status: "misconfigured" };

export type LoginDeps = {
  authenticator: AdminAuthenticator;
  limiter: LoginRateLimiter;
  db: () => Promise<Db>;
  sessionSecret: string | undefined;
  breakGlassHash?: string;
  nowMs: number;
};

/** 後台登入流程：速率限制 → 驗證 → 稽核 → 簽發 session。只有「帳密錯誤」計入失敗次數。 */
export async function performLogin(
  input: { account: string; password: string; ip: string },
  deps: LoginDeps,
): Promise<LoginOutcome> {
  if (!deps.sessionSecret) return { status: "misconfigured" };
  const limited = deps.limiter.check(input.ip, deps.nowMs);
  if (limited) return { status: "rate-limited", ...limited };
  if (!input.account || !input.password) {
    deps.limiter.recordFailure(input.ip, deps.nowMs);
    return { status: "invalid" };
  }
  const result = await loginAdmin(input.account, input.password, {
    primary: deps.authenticator,
    breakGlassHash: deps.breakGlassHash,
  });
  if (result.status === "invalid") {
    deps.limiter.recordFailure(input.ip, deps.nowMs);
    return { status: "invalid" };
  }
  if (result.status === "unavailable") return { status: "unavailable" };
  const session = { ...result.identity, breakGlass: result.breakGlass };
  await auditLogin(await deps.db(), { actor: formatActor(session), breakGlass: result.breakGlass });
  deps.limiter.reset(input.ip);
  return { status: "ok", token: createSessionToken(session, deps.sessionSecret, deps.nowMs) };
}

/** 取得來源 IP：Cloudflare Tunnel 後優先 CF-Connecting-IP，其次 X-Forwarded-For 第一段。 */
export function clientIp(headers: { get(name: string): string | null }): string {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const xff = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || "unknown";
}
