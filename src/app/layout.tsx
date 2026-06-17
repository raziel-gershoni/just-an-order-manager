import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Assistant, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// DOCKET type system: Assistant (Hebrew body), Space Grotesk (Latin display),
// JetBrains Mono (data: prices, grams, ticket numbers).
const assistant = Assistant({
  variable: "--font-assistant",
  subsets: ["hebrew", "latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sourdough Order Manager",
  description: "Manage your bakery orders",
};

// Lock zoom so focusing a small input doesn't auto-zoom the page (app-like, Telegram Mini App).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="he"
      dir="rtl"
      className={`${assistant.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
        {children}
      </body>
    </html>
  );
}
