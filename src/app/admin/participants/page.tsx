import { getAdminSession } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { listParticipants } from "@/lib/admin/queries";
import { AdminNav } from "../nav";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  pending_registration: "待報名",
  active: "正常",
  blocked: "停權",
  unfollowed: "已封鎖官方帳號",
};

export default async function ParticipantsPage() {
  if (!(await getAdminSession())) return null;
  const rows = await listParticipants(await getDb());
  return (
    <>
      <AdminNav />
      <main className="flex flex-col gap-4 p-6">
        <h1 className="text-2xl font-bold">報名列表</h1>
        <p>共 {rows.length} 人（唯讀）</p>
        <table className="border-collapse text-left">
          <thead>
            <tr>
              <th className="border px-2">暱稱</th>
              <th className="border px-2">員工編號</th>
              <th className="border px-2">狀態</th>
              <th className="border px-2">照片數</th>
              <th className="border px-2">已通過</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="border px-2">{r.displayName ?? "—"}</td>
                <td className="border px-2">{r.employeeNo ?? "—"}</td>
                <td className="border px-2">{STATUS_LABEL[r.status] ?? r.status}</td>
                <td className="border px-2">{r.submissionCount}</td>
                <td className="border px-2">{r.approvedCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </>
  );
}
