/** 員工編號查證介面（architecture.md §7.2）。只回傳是否有效，不含任何個人資料。 */
export interface EmployeeVerifier {
  /** 逾時、網路錯誤、非預期回應一律丟 VerifierUnavailableError；呼叫端不得因此放行。 */
  verify(employeeNo: string): Promise<{ valid: boolean }>;
}

export class VerifierUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "VerifierUnavailableError";
  }
}

export const EMPLOYEE_NO_MAX_LENGTH = 32;

/**
 * 輸入正規化：NFKC（全形轉半形）後 trim。不訂格式規則（以請假系統為準），
 * 只擋：空字串、含空白或控制字元、超過長度上限。不合者回 null（視為無效編號，不送出查證）。
 */
export function normalizeEmployeeNo(raw: string): string | null {
  const s = raw.normalize("NFKC").trim();
  if (s.length === 0 || s.length > EMPLOYEE_NO_MAX_LENGTH) return null;
  if (/[\s\u0000-\u001f\u007f]/u.test(s)) return null;
  return s;
}
