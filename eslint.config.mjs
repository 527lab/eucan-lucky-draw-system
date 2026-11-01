import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // S5：資格計算引擎必須是純函式，不得引入任何 I/O 相關模組
  {
    files: ["src/lib/domain/entitlements.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["**/db/**", "drizzle-orm*", "node:*", "fs", "http", "https", "net", "@line/*"], message: "entitlements.ts 必須無 I/O" },
          ],
        },
      ],
      "no-restricted-globals": ["error", "fetch", "process", "Date"],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "entitlements.ts 必須是確定性的" },
        { object: "Date", property: "now", message: "entitlements.ts 必須是確定性的" },
      ],
    },
  },
]);

export default eslintConfig;
