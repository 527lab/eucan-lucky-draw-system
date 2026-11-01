import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * 緊急備援密碼雜湊（ADMIN_PASSWORD_HASH）。格式：`scrypt$<salt base64url>$<hash base64url>`。
 * 產生：`pnpm tsx scripts/hash-password.ts`（互動輸入，雜湊值才放進 env，密碼不進任何檔案）。
 */
const KEYLEN = 64;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEYLEN, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

/** 格式錯誤一律回 false（不丟例外、不放行）。 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "base64url");
  const expected = Buffer.from(parts[2], "base64url");
  if (salt.length === 0 || expected.length !== KEYLEN) return false;
  const actual = await scryptAsync(password, salt);
  return timingSafeEqual(actual, expected);
}
