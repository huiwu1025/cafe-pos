import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cafe POS",
  description: "Tablet-first point of sale dashboard for cafe operations",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant" className="h-full antialiased">
      <body className="min-h-full flex flex-col overflow-hidden">{children}</body>
    </html>
  );
}
