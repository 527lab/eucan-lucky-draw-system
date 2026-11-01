"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { createAdminAuthenticator } from "@/lib/auth/factory";
import { clientIp, performLogin } from "@/lib/auth/login";
import { LoginRateLimiter } from "@/lib/auth/rate-limit";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "@/lib/auth/session";

export type LoginState = { error?: string };

const limiter = new LoginRateLimiter();

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const account = String(form.get("account") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const outcome = await performLogin(
    { account, password, ip: clientIp(await headers()) },
    {
      authenticator: createAdminAuthenticator(),
      limiter,
      db: getDb,
      sessionSecret: process.env.SESSION_SECRET,
      breakGlassHash: process.env.ADMIN_PASSWORD_HASH || undefined,
      nowMs: Date.now(),
    },
  );
  switch (outcome.status) {
    case "invalid":
      return { error: "帳號或密碼錯誤" };
    case "unavailable":
      return { error: "驗證服務暫時無法使用，請稍後再試" };
    case "rate-limited":
      return { error: `嘗試次數過多，請 ${outcome.retryAfterSeconds} 秒後再試` };
    case "misconfigured":
      return { error: "系統設定不完整，請聯絡管理員" };
    case "ok":
      (await cookies()).set(SESSION_COOKIE_NAME, outcome.token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.APP_ENV === "production",
        path: "/",
        maxAge: SESSION_TTL_MS / 1000,
      });
      redirect("/admin");
  }
}

export async function logoutAction(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE_NAME);
  redirect("/admin/login");
}
