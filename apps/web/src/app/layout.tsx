import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AWDRent",
  description: "Rental management for property agencies",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA">
      <body className="min-h-screen bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
