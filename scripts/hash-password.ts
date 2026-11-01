/**
 * 產生 ADMIN_PASSWORD_HASH：從 stdin 讀密碼（不放在命令列參數，避免留在 shell 歷史），輸出雜湊。
 * 用法：  printf '%s' "密碼" | pnpm tsx scripts/hash-password.ts
 */
import { hashPassword } from "../src/lib/auth/password-hash";

async function main() {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const password = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
  if (password.length < 12) {
    console.error("密碼至少 12 字元");
    process.exit(1);
  }
  console.log(await hashPassword(password));
}

void main();
