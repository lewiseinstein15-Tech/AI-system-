import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });

export const metadata: Metadata = {
  title: "Computer Science Hub AI",
  description: "An elite AI-powered learning platform for CS students.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "CS Hub AI",
  },
};

export const viewport: Viewport = {
  themeColor: "#39FF14",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      {/* Removed bg-background from body to let the CSS grid show through */}
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans text-foreground antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}