import Link from "next/link";

export function AdminNav() {
  return (
    <nav aria-label="後台導覽" className="flex gap-4 border-b p-3">
      <Link href="/admin">首頁</Link>
      <Link href="/admin/participants">報名者</Link>
      <Link href="/admin/submissions">照片</Link>
    </nav>
  );
}
