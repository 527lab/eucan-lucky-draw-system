import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 自架 Docker 部署用（architecture.md）
  output: "standalone",
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
