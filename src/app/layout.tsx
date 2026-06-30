import type { Metadata } from "next";
// Self-hosted Geist via the official package (next/font/local under the hood).
// Avoids a build-time network fetch to Google Fonts, so Docker builds are hermetic.
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { GameProvider } from "@/components/GameProvider";

const geistSans = GeistSans;
const geistMono = GeistMono;

export const metadata: Metadata = {
  title: "Dev Social — Happy Hour Games",
  description:
    "Live party games for the team happy hour. Host a room, grab your phone, and play together.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* suppressHydrationWarning: browser extensions (e.g. Grammarly) inject
          attributes onto <body> before hydration, causing benign mismatches. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <GameProvider>{children}</GameProvider>
      </body>
    </html>
  );
}
