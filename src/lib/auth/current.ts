import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionToken, type AdminSession } from "./session";

/** 取得目前請求的後台 session（server component／action／route handler 共用）。 */
export async function getAdminSession(): Promise<AdminSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(token, process.env.SESSION_SECRET ?? "", Date.now());
}
