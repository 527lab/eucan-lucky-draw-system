import { getAdminSession } from "@/lib/auth/current";
import { formatActor } from "@/lib/auth/session";
import { logoutAction } from "./login/actions";
import { AdminNav } from "./nav";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const session = await getAdminSession();
  return (
    <>
      <AdminNav />
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <h1 className="text-2xl font-bold">後台首頁</h1>
        <p>目前登入：{session ? formatActor(session) : "未知"}</p>
        <form action={logoutAction}>
          <button type="submit" className="rounded border px-3 py-1">
            登出
          </button>
        </form>
      </main>
    </>
  );
}
