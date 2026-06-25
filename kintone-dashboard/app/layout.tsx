import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "レンタル売上ダッシュボード",
  description: "kintone アプリ10 / Turso 売上・販売数ダッシュボード",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
