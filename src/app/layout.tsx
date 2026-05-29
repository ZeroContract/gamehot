import type { Metadata } from "next";
import "./globals.css";
import Tracker from "@/components/Tracker";

export const metadata: Metadata = {
  title: "GameHot — 游戏开发热点精选",
  description: "面向中文游戏开发者的 AI 热点信息聚合平台，自动抓取、翻译、评分精选游戏行业动态。",
  metadataBase: new URL("https://gamehot.vercel.app"),
  alternates: {
    types: {
      "application/rss+xml": "/feed.xml",
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#060814" media="(prefers-color-scheme: dark)" />
        <meta name="theme-color" content="#fafbfc" media="(prefers-color-scheme: light)" />
      </head>
      <body>{children}<Tracker /></body>
    </html>
  );
}
