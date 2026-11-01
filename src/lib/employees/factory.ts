import type { Db } from "../db/client";
import type { Settings } from "../settings";
import { createCsvVerifier, createLeaveApiVerifier } from "./adapters";
import type { EmployeeVerifier } from "./verifier";

/** 依 employees.source 選轉接器；leave-api 的金鑰只從環境變數讀。 */
export function createVerifier(
  db: Db,
  settings: Pick<Settings, "employees.source">,
  env: Record<string, string | undefined> = process.env,
): EmployeeVerifier {
  if (settings["employees.source"] === "leave-api") {
    return createLeaveApiVerifier({
      baseUrl: env.LEAVE_API_BASE_URL,
      token: env.LEAVE_API_TOKEN,
    });
  }
  return createCsvVerifier(db);
}
