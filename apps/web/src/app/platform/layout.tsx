import type { Metadata } from "next";

export const metadata: Metadata = { title: { default: "AWDRent Platform", template: "%s · AWDRent Platform" } };

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return <div style={{ "--brand": "#0f172a" } as React.CSSProperties}>{children}</div>;
}
