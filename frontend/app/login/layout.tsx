import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in or create a Stealth-Scraper account. Email + password or magic link — no social logins to manage.",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
