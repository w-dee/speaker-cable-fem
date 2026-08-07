import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";
const isUserSite = repositoryName.endsWith(".github.io");
const repositoryBasePath = repositoryName && !isUserSite
  ? `/${repositoryName}`
  : "";
const basePath = isGitHubPages
  ? (process.env.GITHUB_PAGES_BASE_PATH ?? repositoryBasePath)
  : "";

const nextConfig: NextConfig = {
  ...(isGitHubPages
    ? {
        output: "export" as const,
        trailingSlash: true,
        images: { unoptimized: true },
        typescript: { tsconfigPath: "tsconfig.pages.json" },
      }
    : {}),
  ...(basePath ? { basePath } : {}),
};

export default nextConfig;
