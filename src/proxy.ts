import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decideAdminAccess, LOGIN_PATH } from "@/lib/auth/guard";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

/** 後台保護（樂觀檢查：只驗 cookie 簽章與期限；各 handler 仍應自行取 session）。 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const decision = decideAdminAccess(
    pathname,
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
    process.env.SESSION_SECRET,
    Date.now(),
  );
  if (decision === "unauthorized") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (decision === "redirect-login") {
    return NextResponse.redirect(new URL(LOGIN_PATH, request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
