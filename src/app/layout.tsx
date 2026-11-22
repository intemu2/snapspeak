import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SnapSpeak — Visual Search Assistant",
  description:
    "Upload a photo, Gemini describes it in English and Bahasa Indonesia, and reads it aloud. Image in, text + speech out.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
