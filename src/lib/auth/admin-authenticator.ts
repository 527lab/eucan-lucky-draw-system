import { verifyPassword } from "./password-hash";

export type AdminIdentity = { employeeNo: string; name: string };

export class AuthUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthUnavailableError";
  }
}

export interface AdminAuthenticator {
  /** 帳密正確且具主管權限回身分，否則 null；驗證服務不可用丟 AuthUnavailableError（不放行）。 */
  authenticate(account: string, password: string): Promise<AdminIdentity | null>;
}

export const LEAVE_AUTH_TIMEOUT_MS = 5000;

export type LeaveAuthOptions = {
  baseUrl: string | undefined;
  token: string | undefined;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/**
 * leave-api：POST {base}/api/integrations/auth/verify（architecture.md §7.4 (2)）。
 * 只有 HTTP 200 且格式正確才有結論；`ok && isManager` 才放行。密碼只放在 request body，
 * 不寫入 log、錯誤訊息或 cause（因此錯誤一律不帶 cause）。
 */
export function createLeaveApiAuthenticator(opts: LeaveAuthOptions): AdminAuthenticator {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? LEAVE_AUTH_TIMEOUT_MS;
  return {
    async authenticate(account, password) {
      if (!opts.baseUrl || !opts.token) {
        throw new AuthUnavailableError("LEAVE_API_BASE_URL／LEAVE_API_TOKEN 未設定");
      }
      const url = `${opts.baseUrl.replace(/\/+$/, "")}/api/integrations/auth/verify`;
      let res: Response;
      try {
        res = await doFetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${opts.token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ account, password }),
          signal: AbortSignal.timeout(timeoutMs),
          cache: "no-store",
        });
      } catch {
        throw new AuthUnavailableError("請假系統連線失敗或逾時");
      }
      if (res.status !== 200) throw new AuthUnavailableError(`請假系統回應 HTTP ${res.status}`);
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new AuthUnavailableError("請假系統回應不是 JSON");
      }
      if (typeof body !== "object" || body === null) {
        throw new AuthUnavailableError("請假系統回應格式錯誤");
      }
      const b = body as Record<string, unknown>;
      if (typeof b.ok !== "boolean") throw new AuthUnavailableError("請假系統回應格式錯誤");
      if (!b.ok) return null;
      if (
        typeof b.employeeNo !== "string" ||
        b.employeeNo.length === 0 ||
        typeof b.name !== "string" ||
        typeof b.isManager !== "boolean"
      ) {
        throw new AuthUnavailableError("請假系統回應格式錯誤");
      }
      if (!b.isManager) return null;
      return { employeeNo: b.employeeNo, name: b.name };
    },
  };
}

export type MockAccount = { password: string; employeeNo: string; name: string };

/** mock：僅非 production 可用（開發、測試、E2E）。 */
export function createMockAuthenticator(
  accounts: Record<string, MockAccount>,
  opts: { appEnv: string; unavailable?: boolean },
): AdminAuthenticator {
  if (opts.appEnv === "production") {
    throw new Error("mock 後台登入不可用於 production");
  }
  return {
    async authenticate(account, password) {
      if (opts.unavailable) throw new AuthUnavailableError("mock unavailable");
      const a = Object.hasOwn(accounts, account) ? accounts[account] : undefined;
      if (!a || a.password !== password) return null;
      return { employeeNo: a.employeeNo, name: a.name };
    },
  };
}

export const BREAK_GLASS_ACCOUNT = "break-glass";

export type AdminLoginResult =
  | { status: "ok"; identity: AdminIdentity; breakGlass: boolean }
  | { status: "invalid" }
  | { status: "unavailable" };

/**
 * 登入協調：帳號為 `break-glass` 且有設定 ADMIN_PASSWORD_HASH 才走緊急備援（只比對雜湊）；
 * 否則走主要 authenticator（備援未設定時 `break-glass` 只是個一般帳號名，無法登入）。
 * 呼叫端（登入 action）需在 ok 且 breakGlass 時寫稽核。
 */
export async function loginAdmin(
  account: string,
  password: string,
  deps: { primary: AdminAuthenticator; breakGlassHash?: string },
): Promise<AdminLoginResult> {
  if (account === BREAK_GLASS_ACCOUNT && deps.breakGlassHash) {
    const ok = await verifyPassword(password, deps.breakGlassHash);
    return ok
      ? { status: "ok", identity: { employeeNo: BREAK_GLASS_ACCOUNT, name: "" }, breakGlass: true }
      : { status: "invalid" };
  }
  try {
    const identity = await deps.primary.authenticate(account, password);
    return identity ? { status: "ok", identity, breakGlass: false } : { status: "invalid" };
  } catch (err) {
    if (err instanceof AuthUnavailableError) return { status: "unavailable" };
    throw err;
  }
}
