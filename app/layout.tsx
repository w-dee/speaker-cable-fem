import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "スピーカーケーブル 表皮・近接効果シミュレーター",
  description: "2本の円形銅単線を2D磁気準静的FEMで解き、表皮効果・近接効果・交流抵抗・伝送損失を可視化します。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
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
