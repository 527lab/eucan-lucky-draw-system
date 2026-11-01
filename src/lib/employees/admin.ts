import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { adminAuditLogs, employeeAllowlist, participants } from "../db/schema";
import { normalizeEmployeeNo } from "./verifier";

const HEADERS = new Set(["員工編號", "編號", "employee_no", "employeeno", "employee no"]);

export type ParsedAllowlist = { numbers: string[]; rejected: number };

/** 單欄 CSV → 正規化後去重的編號清單。取第一欄；允許 BOM、引號、標頭列；不合格者計入 rejected。 */
export function parseAllowlistCsv(csv: string): ParsedAllowlist {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/);
  const seen = new Set<string>();
  let rejected = 0;
  let first = true;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const cell = (line.split(",")[0] ?? "").trim().replace(/^"(.*)"$/, "$1");
    if (first) {
      first = false;
      if (HEADERS.has(cell.toLowerCase())) continue;
    }
    const n = normalizeEmployeeNo(cell);
    if (n === null) rejected += 1;
    else seen.add(n);
  }
  return { numbers: [...seen], rejected };
}

/** 覆蓋 employee_allowlist（只存編號）。名單為空時拒絕，避免誤傳空檔清空名單。稽核只記數量。 */
export async function replaceAllowlist(db: Db, csv: string, actor: string) {
  const { numbers, rejected } = parseAllowlistCsv(csv);
  if (numbers.length === 0) throw new Error("名單中沒有有效的員工編號，未做任何變更");
  await db.transaction(async (tx) => {
    await tx.delete(employeeAllowlist);
    for (let i = 0; i < numbers.length; i += 500) {
      await tx
        .insert(employeeAllowlist)
        .values(numbers.slice(i, i + 500).map((employeeNo) => ({ employeeNo })));
    }
    await tx.insert(adminAuditLogs).values({
      actor,
      action: "employees.allowlist.replace",
      targetType: "employee_allowlist",
      payload: { imported: numbers.length, rejected },
    });
  });
  return { imported: numbers.length, rejected };
}

/** 停權：狀態改 blocked 並釋出 employee_no，讓真正的員工可重新報名。寫稽核。 */
export async function suspendParticipant(db: Db, participantId: string, actor: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(participants)
      .set({ status: "blocked", employeeNo: null, employeeVerifiedAt: null })
      .where(eq(participants.id, participantId))
      .returning({ id: participants.id });
    if (!row) throw new Error("找不到參加者");
    await tx.insert(adminAuditLogs).values({
      actor,
      action: "participant.suspend",
      targetType: "participant",
      targetId: participantId,
      payload: { releasedEmployeeNo: true },
    });
    return row;
  });
}
