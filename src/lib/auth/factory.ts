import {
  createLeaveApiAuthenticator,
  createMockAuthenticator,
  type AdminAuthenticator,
} from "./admin-authenticator";

/** mock 固定測試帳號（假資料，僅非 production 可用）。 */
export const MOCK_TEST_ACCOUNT = {
  account: "test-manager",
  password: "test-password",
  employeeNo: "E0001",
  name: "測試主管",
} as const;

/** 依 ADMIN_AUTH_SOURCE 選 authenticator；leave-api 的金鑰只從環境變數讀。 */
export function createAdminAuthenticator(
  env: Record<string, string | undefined> = process.env,
): AdminAuthenticator {
  const source = env.ADMIN_AUTH_SOURCE ?? "leave-api";
  if (source === "mock") {
    return createMockAuthenticator(
      {
        [MOCK_TEST_ACCOUNT.account]: {
          password: MOCK_TEST_ACCOUNT.password,
          employeeNo: MOCK_TEST_ACCOUNT.employeeNo,
          name: MOCK_TEST_ACCOUNT.name,
        },
      },
      { appEnv: env.APP_ENV ?? "development" },
    );
  }
  return createLeaveApiAuthenticator({
    baseUrl: env.LEAVE_API_BASE_URL,
    token: env.LEAVE_API_TOKEN,
  });
}
