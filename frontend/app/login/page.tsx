"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Mail, Lock, Github } from "lucide-react";
import { motion } from "framer-motion";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup" | "magic";

function LoginForm() {
  const search = useSearchParams();
  // Default post-login landing is /, NOT /pick. /pick's empty state used
  // to be a dead-end with no nav — users got dumped there with no context.
  const next = search.get("next") || "/";
  const initialMode: Mode =
    search.get("mode") === "signup" ? "signup" :
    search.get("mode") === "magic" ? "magic" : "signin";

  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  function switchMode(m: Mode) {
    setMode(m);
    setStatus("idle");
    setMessage("");
  }

  // OAuth sign-in. Supabase handles the full redirect dance — we just
  // hand it a provider + return URL and the browser navigates away. On
  // return, /auth/callback exchanges the ?code= for a session.
  async function handleOAuth(provider: "github" | "google") {
    setStatus("sending");
    setMessage("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setStatus("error");
      setMessage(error.message);
    }
    // success path: the browser is already navigating to the provider
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setMessage("");
    const supabase = createClient();

    if (mode === "magic") {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
      });
      if (error) { setStatus("error"); setMessage(error.message); }
      else { setStatus("sent"); setMessage(`We sent a sign-in link to ${email}.`); }
      return;
    }
    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
      });
      if (error) { setStatus("error"); setMessage(error.message); }
      else if (data.session) { window.location.href = next; }
      else { setStatus("sent"); setMessage(`Check ${email} for a confirmation link.`); }
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setStatus("error"); setMessage(error.message); }
    else { window.location.href = next; }
  }

  const isSent = status === "sent";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
      className="w-full max-w-sm"
    >
      <Link href="/" className="mb-12 block">
        <Brand />
      </Link>

      <h1 className="mb-2 text-[24px] font-semibold tracking-[-0.015em] text-[var(--color-fg-strong)]">
        {mode === "signup" ? "Create your account" : "Welcome back"}
      </h1>
      <p className="mb-8 text-[13px] text-[var(--color-fg-muted)]">
        {mode === "magic" ? "We'll email you a one-tap link." :
         mode === "signup" ? "50 scrapes/month free. No credit card." :
         "Continue to your dashboard."}
      </p>

      {/* OAuth — hidden on the post-submit "check your email" view */}
      {!isSent && (
        <>
          <div className="mb-4 space-y-2">
            <button
              type="button"
              onClick={() => handleOAuth("github")}
              disabled={status === "sending"}
              className={cn(
                "inline-flex w-full items-center justify-center gap-2 rounded-md border h-11 px-5 text-[14px] font-medium",
                "border-[var(--color-border)] bg-[var(--color-fg-strong)] text-[var(--color-bg)]",
                "transition-[background,border-color,opacity] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                "hover:bg-[var(--color-fg-display)] disabled:pointer-events-none disabled:opacity-50",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-line)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]",
              )}
            >
              <Github className="h-4 w-4" />
              <span>Continue with GitHub</span>
            </button>
            <button
              type="button"
              onClick={() => handleOAuth("google")}
              disabled={status === "sending"}
              className={cn(
                "inline-flex w-full items-center justify-center gap-2 rounded-md border h-11 px-5 text-[14px] font-medium",
                "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)]",
                "transition-[background,border-color,opacity] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                "hover:border-[var(--color-border-strong)] hover:bg-[var(--color-elevated)] disabled:pointer-events-none disabled:opacity-50",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-line)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]",
              )}
            >
              {/* lucide-react ships no Google logo. Inline the official
                  "G" multicolor mark — same SVG Google publishes for
                  third-party sign-in buttons. Kept small + accessible. */}
              <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
                <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
                <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
                <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
              </svg>
              <span>Continue with Google</span>
            </button>
          </div>

          {/* "or use email" divider */}
          <div className="mb-5 flex items-center gap-3 text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subdued)]">
            <span className="h-px flex-1 bg-[var(--color-border)]" />
            <span>or use email</span>
            <span className="h-px flex-1 bg-[var(--color-border)]" />
          </div>
        </>
      )}

      {/* Segmented control */}
      <div className="mb-6 inline-flex rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5 text-[12px]">
        {(["signin", "signup", "magic"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => switchMode(m)}
            className={cn(
              "rounded-[4px] px-3 py-1.5 transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
              mode === m
                ? "bg-[var(--color-fg)] text-[var(--color-bg)] font-medium"
                : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
            )}
          >
            {m === "signin" ? "Sign in" : m === "signup" ? "Sign up" : "Magic link"}
          </button>
        ))}
      </div>

      {isSent ? (
        <div className="rounded-lg border border-[color:var(--color-accent)]/30 bg-[var(--color-accent-faint)] p-5">
          <Mail className="mb-2 h-4 w-4 text-[var(--color-accent)]" />
          <p className="text-[13px] text-[var(--color-fg)]">{message}</p>
          <p className="mt-2 text-[11px] text-[var(--color-fg-muted)]">
            Didn&apos;t arrive? Check spam, or{" "}
            <button onClick={() => switchMode(mode === "magic" ? "signin" : "magic")} className="text-[var(--color-accent)] hover:underline">
              try another method
            </button>.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            type="email" required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            size="lg"
          />
          {mode !== "magic" && (
            <Input
              type="password" required minLength={6}
              placeholder={mode === "signup" ? "Choose a password (6+ chars)" : "Password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              size="lg"
            />
          )}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={status === "sending"}
            className="w-full"
          >
            {status === "sending" ? "Working…" : (
              <>
                {mode === "magic" ? <Mail className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                {mode === "signup" ? "Create account" : mode === "magic" ? "Send link" : "Sign in"}
              </>
            )}
          </Button>
          {status === "error" && message && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-[color:var(--color-danger)]/30 bg-[var(--color-danger-dim)] p-3 text-[12px] text-[color:var(--color-danger)]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>{message}</span>
            </div>
          )}
        </form>
      )}

      <div className="mt-8 border-t border-[var(--color-border)] pt-6 text-center text-[12px] text-[var(--color-fg-subdued)]">
        By continuing you agree to our{" "}
        <Link href="/terms" className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:underline">Terms</Link>
        {" "}and{" "}
        <Link href="/privacy" className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:underline">Privacy Policy</Link>
        .{" "}
        <Link href="/pricing" className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:underline">See pricing</Link>.
      </div>
    </motion.div>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-6 py-12">
      <Suspense
        fallback={
          <div className="w-full max-w-sm">
            <div className="mb-12 h-5 w-32 animate-pulse rounded-sm bg-[var(--color-surface)]" />
            <div className="mb-2 h-7 w-40 animate-pulse rounded-sm bg-[var(--color-surface)]" />
            <div className="mb-8 h-4 w-56 animate-pulse rounded-sm bg-[var(--color-surface)]" />
            <div className="space-y-3">
              <div className="h-11 w-full animate-pulse rounded-md bg-[var(--color-surface)]" />
              <div className="h-11 w-full animate-pulse rounded-md bg-[var(--color-surface)]" />
              <div className="h-11 w-full animate-pulse rounded-md bg-[var(--color-surface)]" />
            </div>
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </main>
  );
}
