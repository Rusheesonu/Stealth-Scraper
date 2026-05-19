"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup" | "magic";

export default function LoginPage() {
  const search = useSearchParams();
  const next = search.get("next") || "/pick";

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  function switchMode(m: Mode) {
    setMode(m);
    setStatus("idle");
    setMessage("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setMessage("");

    const supabase = createClient();

    if (mode === "magic") {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) {
        setStatus("error");
        setMessage(error.message);
      } else {
        setStatus("sent");
        setMessage(`Magic link sent to ${email}. Check your inbox.`);
      }
      return;
    }

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) {
        setStatus("error");
        setMessage(error.message);
      } else if (data.session) {
        // Email confirmation disabled in Supabase → signed in immediately.
        window.location.href = next;
      } else {
        // Email confirmation required.
        setStatus("sent");
        setMessage(
          `Account created. Check ${email} for a confirmation link, then sign in.`,
        );
      }
      return;
    }

    // signin (password)
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setStatus("error");
      setMessage(error.message);
    } else {
      window.location.href = next;
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-2 text-2xl font-semibold">
          {mode === "signup" ? "Create account" : "Sign in"}
        </h1>
        <p className="mb-6 text-sm text-zinc-400">
          {mode === "magic"
            ? "One-tap email link — no password needed."
            : mode === "signup"
            ? "Email + password. Takes 5 seconds."
            : "Welcome back."}
        </p>

        {/* Mode tabs */}
        <div className="mb-6 flex rounded-md border border-zinc-800 bg-zinc-900/40 p-1 text-xs">
          {(["signin", "signup", "magic"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`flex-1 rounded px-3 py-1.5 transition ${
                mode === m
                  ? "bg-white text-zinc-900 font-medium"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {m === "signin" ? "Sign in" : m === "signup" ? "Sign up" : "Magic link"}
            </button>
          ))}
        </div>

        {status === "sent" ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
            <p className="text-sm">{message}</p>
            <p className="mt-2 text-xs text-zinc-500">
              Didn&apos;t get it? Check spam, or try a different option above.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-600"
              autoComplete="email"
            />
            {mode !== "magic" && (
              <input
                type="password"
                required
                minLength={6}
                placeholder={mode === "signup" ? "Password (6+ chars)" : "Password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-600"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
              />
            )}
            <button
              type="submit"
              disabled={status === "sending"}
              className="w-full rounded-md bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-100 disabled:opacity-50"
            >
              {status === "sending"
                ? "Working…"
                : mode === "signup"
                ? "Create account"
                : mode === "magic"
                ? "Send magic link"
                : "Sign in"}
            </button>
            {status === "error" && message && (
              <p className="text-xs text-red-400">{message}</p>
            )}
            {mode === "signin" && (
              <p className="pt-1 text-center text-xs text-zinc-500">
                New here?{" "}
                <button
                  type="button"
                  onClick={() => switchMode("signup")}
                  className="text-zinc-300 hover:underline"
                >
                  Create an account
                </button>
              </p>
            )}
          </form>
        )}
      </div>
    </main>
  );
}
