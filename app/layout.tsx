import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";

// Inter is a metrics-compatible substitute for San Francisco (true SF Pro
// isn't licensable for web embedding). The -apple-system/BlinkMacSystemFont
// stack in globals.css's --font-sans means real Mac/iOS users still get
// native San Francisco; Inter only kicks in as the fallback everywhere else.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Internal Tools",
  description: "F22 internal tools portal",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
