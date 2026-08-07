import type { Metadata } from "next";
import "./globals.css";

const isGitHubPages = process.env.GITHUB_PAGES === "true";
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";
const isUserSite = repositoryName.endsWith(".github.io");
const repositoryBasePath = repositoryName && !isUserSite
  ? `/${repositoryName}`
  : "";
const basePath = isGitHubPages
  ? (process.env.GITHUB_PAGES_BASE_PATH ?? repositoryBasePath)
  : "";
const faviconPath = `${basePath}/favicon.svg`;

export const metadata: Metadata = {
  title: "スピーカーケーブル 表皮・近接効果シミュレーター",
  description: "2本の円形銅単線を2D磁気準静的FEMで解き、表皮効果・近接効果・交流抵抗・伝送損失を可視化します。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: faviconPath,
    shortcut: faviconPath,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
