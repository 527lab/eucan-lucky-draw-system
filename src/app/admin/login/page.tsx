import { LoginForm } from "./login-form";

export default function AdminLoginPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-bold">後台登入</h1>
      <LoginForm />
    </main>
  );
}
