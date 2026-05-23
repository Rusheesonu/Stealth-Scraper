import Link from "next/link";
import { Brand } from "@/components/brand";
import { LoginForm } from "./login-form";

/**
 * /login — server component shell with SSR'd h1 + intro. The interactive
 * form lives in `./login-form.tsx` as a client component (Supabase auth
 * dance + segmented mode control). Keeping the headline server-rendered
 * fixes the empty-shell SEO/first-paint issue flagged in the launch audit.
 */
export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-6 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-12 block">
          <Brand />
        </Link>

        <h1 className="mb-2 text-[20px] font-semibold tracking-[-0.015em] text-[var(--color-fg-strong)]">
          Sign in
        </h1>
        <p className="mb-8 text-[13px] text-[var(--color-fg-muted)]">
          Welcome back. We&apos;ll get you to the picker in two clicks.
        </p>

        <LoginForm />
      </div>
    </main>
  );
}
