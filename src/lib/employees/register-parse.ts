import { normalizeEmployeeNo } from "./verifier";

export type ParsedRegistration =
  | { kind: "none" } // 不是報名指令
  | { kind: "usage" } // 只有指令、沒有編號
  | { kind: "attempt"; employeeNo: string | null }; // null = 編號格式不可接受（過長／含空白）

/**
 * 解析「registration.command＋編號」。指令與編號間空白可有可無，全形半形皆可
 * （比對前兩邊都做 NFKC）。
 */
export function parseRegistration(text: string, command: string): ParsedRegistration {
  const t = text.normalize("NFKC").trim();
  const c = command.normalize("NFKC").trim();
  if (!c || !t.startsWith(c)) return { kind: "none" };
  const rest = t.slice(c.length).trim();
  if (rest === "") return { kind: "usage" };
  return { kind: "attempt", employeeNo: normalizeEmployeeNo(rest) };
}
