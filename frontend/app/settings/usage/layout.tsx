import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Usage",
  description: "Current month's snapshot, AI-extract, and template usage against your plan quota.",
  robots: { index: false, follow: false },
};

export default function UsageLayout({ children }: { children: React.ReactNode }) {
  return children;
}
