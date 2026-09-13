import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "ScrapePilot — turn the web into structured data",
  description: "Build, run, and share visual scraping workflows.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
