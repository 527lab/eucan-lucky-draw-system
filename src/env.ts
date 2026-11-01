import { z } from "zod";

/**
 * 環境變數驗證（spec.md §7.1）。
 * - APP_ENV=test 時允許缺值（單元測試不需要完整設定）。
 * - 其他環境缺少必要鍵名時，拋出列出所有缺少鍵名的錯誤。
 * - TUNNEL_TOKEN 只給 cloudflared 容器使用，不進 app，因此不在此驗證。
 */
const nonEmpty = z.string().min(1);

const baseSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  LINE_CHANNEL_SECRET: nonEmpty,
  LINE_CHANNEL_ACCESS_TOKEN: nonEmpty,
  DATABASE_URL: nonEmpty,
  PHOTO_STORAGE_DIR: nonEmpty,
  SESSION_SECRET: nonEmpty,
  CRON_SECRET: nonEmpty,
  APP_BASE_URL: z.url(),
  ADMIN_AUTH_SOURCE: z.enum(["leave-api", "mock"]).default("leave-api"),
  LEAVE_API_BASE_URL: z.string().optional(),
  LEAVE_API_TOKEN: z.string().optional(),
  ADMIN_PASSWORD_HASH: z.string().optional(),
});

export type Env = z.infer<typeof baseSchema>;

export class EnvError extends Error {
  constructor(
    message: string,
    readonly missing: string[],
  ) {
    super(message);
    this.name = "EnvError";
  }
}

/** 空字串視為未設定。 */
function normalize(source: Record<string, string | undefined>) {
  const out: Record<string, string | undefined> = {};
  for (const key of Object.keys(baseSchema.shape)) {
    const v = source[key];
    out[key] = v === undefined || v === "" ? undefined : v;
  }
  return out;
}

/** 純函式：驗證給定的環境變數物件。 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const input = normalize(source);

  if (input.APP_ENV === "test") {
    // 測試環境允許缺值：不強制必填。
    return {
      ...(input as unknown as Env),
      APP_ENV: "test",
      ADMIN_AUTH_SOURCE:
        (input.ADMIN_AUTH_SOURCE as Env["ADMIN_AUTH_SOURCE"]) ?? "mock",
    };
  }

  const result = baseSchema.safeParse(input);
  const missing: string[] = [];
  const invalid: string[] = [];

  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = String(issue.path[0]);
      if (input[key] === undefined) missing.push(key);
      else invalid.push(`${key}（${issue.message}）`);
    }
  } else {
    const e = result.data;
    if (e.ADMIN_AUTH_SOURCE === "leave-api") {
      if (!e.LEAVE_API_BASE_URL) missing.push("LEAVE_API_BASE_URL");
      if (!e.LEAVE_API_TOKEN) missing.push("LEAVE_API_TOKEN");
    }
    if (e.APP_ENV === "production" && e.ADMIN_AUTH_SOURCE === "mock") {
      invalid.push("ADMIN_AUTH_SOURCE（production 不可使用 mock）");
    }
    if (missing.length === 0 && invalid.length === 0) return e;
  }

  const lines = ["環境變數設定有誤："];
  if (missing.length) lines.push(`  缺少：${missing.join(", ")}`);
  if (invalid.length) lines.push(`  無效：${invalid.join(", ")}`);
  lines.push("請參考 .env.example 補齊後重新啟動。");
  throw new EnvError(lines.join("\n"), missing);
}

let cached: Env | undefined;

/** 取得驗證過的 env（結果會快取）。 */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
