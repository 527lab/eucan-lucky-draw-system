import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 自架 Docker 部署用（architecture.md）
  output: "standalone",
  // PGlite（僅 E2E／測試用的記憶體 DB）需以原生 Node 載入，不能被打包。
  serverExternalPackages: ["@electric-sql/pglite"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
