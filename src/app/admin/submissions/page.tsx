import { getAdminSession } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import {
  listSpotOptions,
  listSubmissions,
  parseSubmissionStatus,
  SUBMISSION_STATUSES,
} from "@/lib/admin/queries";
import { AdminNav } from "../nav";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  pending_spot: "待選景點",
  pending_review: "待審核",
  approved: "已通過",
  rejected: "已退件",
};

export default async function SubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; spot?: string }>;
}) {
  // proxy 只是樂觀檢查，這裡自行再確認 session。
  if (!(await getAdminSession())) return null;
  const sp = await searchParams;
  const status = parseSubmissionStatus(sp.status);
  const db = await getDb();
  const [rows, spotOptions] = await Promise.all([
    listSubmissions(db, { status, spotId: sp.spot || undefined }),
    listSpotOptions(db),
  ]);
  return (
    <>
      <AdminNav />
      <main className="flex flex-col gap-4 p-6">
        <h1 className="text-2xl font-bold">照片列表</h1>
        <form method="get" className="flex gap-2">
          <label>
            狀態
            <select name="status" defaultValue={status ?? ""} className="ml-1 border">
              <option value="">全部</option>
              {SUBMISSION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            景點
            <select name="spot" defaultValue={sp.spot ?? ""} className="ml-1 border">
              <option value="">全部</option>
              {spotOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded border px-3">
            篩選
          </button>
        </form>
        <p>共 {rows.length} 筆（唯讀）</p>
        <table className="border-collapse text-left">
          <thead>
            <tr>
              <th className="border px-2">時間</th>
              <th className="border px-2">參加者</th>
              <th className="border px-2">景點</th>
              <th className="border px-2">狀態</th>
              <th className="border px-2">退件原因</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="border px-2">
                  {r.createdAt.toISOString().replace("T", " ").slice(0, 16)}
                </td>
                <td className="border px-2">
                  {r.displayName ?? "—"} {r.employeeNo ?? ""}
                </td>
                <td className="border px-2">{r.spotName ?? "（未選）"}</td>
                <td className="border px-2">{STATUS_LABEL[r.status]}</td>
                <td className="border px-2">{r.rejectReason ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </>
  );
}
