import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#171925",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://night-mailbox.example"),
  title: "夜航信箱｜AI 陪伴",
  description: "一个会记得、会回应、也尊重边界的 AI 陪伴空间。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "夜航信箱",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    title: "夜航信箱｜有人在听，也有人在乎",
    description: "定制性格、连续对话、共同任务与场景记忆。",
    images: [{ url: "/og.png", width: 1672, height: 941, alt: "夜航信箱" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "夜航信箱｜有人在听，也有人在乎",
    description: "定制性格、连续对话、共同任务与场景记忆。",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
