import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { employeeAllowlist } from "../db/schema";
import { VerifierUnavailableError, type EmployeeVerifier } from "./verifier";

/** csv：比對後台上傳的 employee_allowlist。 */
export function createCsvVerifier(db: Db): EmployeeVerifier {
  return {
    async verify(employeeNo) {
      const rows = await db
        .select({ n: employeeAllowlist.employeeNo })
        .from(employeeAllowlist)
        .where(eq(employeeAllowlist.employeeNo, employeeNo))
        .limit(1);
      return { valid: rows.length > 0 };
    },
  };
}

/** mock：測試用。valid 為在職名單；unavailable 為 true 時模擬故障。 */
export function createMockVerifier(
  valid: Iterable<string>,
  opts: { unavailable?: boolean } = {},
): EmployeeVerifier & { calls: string[] } {
  const set = new Set(valid);
  const calls: string[] = [];
  return {
    calls,
    async verify(employeeNo) {
      calls.push(employeeNo);
      if (opts.unavailable) throw new VerifierUnavailableError("mock unavailable");
      return { valid: set.has(employeeNo) };
    },
  };
}

export const LEAVE_API_TIMEOUT_MS = 3000;

export type LeaveApiOptions = {
  baseUrl: string | undefined;
  token: string | undefined;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/**
 * leave-api：GET {base}/api/integrations/employees/{no}/status（architecture.md §7.4）。
 * 只有 HTTP 200 且 body 為 {valid: boolean} 才有結論；其餘（逾時、網路錯誤、非 200、
 * 格式錯誤、設定缺漏）一律丟 VerifierUnavailableError，絕不放行。
 */
export function createLeaveApiVerifier(opts: LeaveApiOptions): EmployeeVerifier {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? LEAVE_API_TIMEOUT_MS;
  return {
    async verify(employeeNo) {
      if (!opts.baseUrl || !opts.token) {
        throw new VerifierUnavailableError("LEAVE_API_BASE_URL／LEAVE_API_TOKEN 未設定");
      }
      const url = `${opts.baseUrl.replace(/\/+$/, "")}/api/integrations/employees/${encodeURIComponent(employeeNo)}/status`;
      let res: Response;
      try {
        res = await doFetch(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${opts.token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
          cache: "no-store",
        });
      } catch (err) {
        throw new VerifierUnavailableError("請假系統連線失敗或逾時", { cause: err });
      }
      if (res.status !== 200) {
        throw new VerifierUnavailableError(`請假系統回應 HTTP ${res.status}`);
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch (err) {
        throw new VerifierUnavailableError("請假系統回應不是 JSON", { cause: err });
      }
      const valid =
        typeof body === "object" && body !== null ? (body as { valid?: unknown }).valid : undefined;
      if (typeof valid !== "boolean") {
        throw new VerifierUnavailableError("請假系統回應格式錯誤");
      }
      return { valid };
    },
  };
}
