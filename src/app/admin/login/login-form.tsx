"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form action={action} className="flex w-full max-w-sm flex-col gap-4">
      <label className="flex flex-col gap-1">
        帳號
        <input name="account" autoComplete="username" required className="rounded border p-2" />
      </label>
      <label className="flex flex-col gap-1">
        密碼
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded border p-2"
        />
      </label>
      {state.error && (
        <p role="alert" className="text-red-600">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="rounded bg-black p-2 text-white">
        {pending ? "登入中…" : "登入"}
      </button>
    </form>
  );
}
