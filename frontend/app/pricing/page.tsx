"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ArrowRight } from "lucide-react";
import { PageShell } from "@/components/nav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { MotionStagger, MotionStaggerItem } from "@/components/motion-primitives";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { SLABanner } from "@/components/sla-banner";
import { ReviewBlock } from "@/components/review-block";

type Plan = "hobby" | "pro" | "business";

const TIERS: {
  plan: Plan | "free";
  name: string;
  price: string;
  blurb: string;
  features: string[];
  cta: string;
  highlight?: boolean;
}[] = [
  {
    plan: "free", name: "Free", price: "$0", blurb: "Try it without a card.",
    features: ["50 scrapes/month", "Soft sites only", "Visual picker + AI extract", "Community templates"],
    cta: "Sign in",
  },
  {
    plan: "hobby", name: "Hobby", price: "$29", blurb: "Single-developer experiments.",
    features: ["1,000 scrapes/month", "Cloudflare + Datadome unlocked", "Saved templates", "Email support"],
    cta: "Start Hobby",
  },
  {
    plan: "pro", name: "Pro", price: "$99", blurb: "AI agents, RAG pipelines, real workflows.",
    features: ["10,000 scrapes/month", "REST API + Python/TS SDKs + MCP", "Scheduled runs + webhooks", "Batch URL processing", "All Hobby features"],
    cta: "Start Pro",
    highlight: true,
  },
  {
    plan: "business", name: "Business", price: "$299", blurb: "Agencies, growing teams, higher volume.",
    features: ["100,000 scrapes/month", "Team seats", "Priority support", "All Pro features"],
    cta: "Start Business",
  },
];

export default function PricingPage() {
  const [loadingPlan, setLoadingPlan] = useState<Plan | null>(null);
  const [error, setError] = useState("");

  async function handleCta(plan: Plan | "free") {
    if (plan === "free") {
      window.location.href = "/login";
      return;
    }
    setLoadingPlan(plan);
    setError("");
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      window.location.href = `/login?next=/pricing`;
      return;
    }
    try {
      const { checkout_url } = await api.createCheckout(plan);
      window.location.href = checkout_url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "checkout failed");
      setLoadingPlan(null);
    }
  }

  return (
    <PageShell maxWidth="max-w-6xl">
      <div className="md:py-4">
        <div className="mb-6">
          <Link
            href="/"
            className="group inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 -ml-1.5 text-[14px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]"
          >
            <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-[var(--dur-fast)] group-hover:-translate-x-0.5" />
            Home
          </Link>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
          className="mb-12 text-center"
        >
          <Badge tone="muted" className="mb-5">Pricing · USD</Badge>
          <h1 className="text-[44px] font-semibold leading-[1.05] tracking-[-0.028em] text-[var(--color-fg-strong)] sm:text-[52px]">
            Honest pricing.<br />No dark patterns.
          </h1>
          <div className="mt-7 flex justify-center">
            <SLABanner variant="hero" />
          </div>
          <p className="mx-auto mt-5 max-w-lg text-[17px] leading-[1.55] text-[var(--color-fg-muted)]">
            Three tiers. No fake urgency. No &quot;most popular&quot; sticker we made up.
            Cancel anytime, 14-day refund.
          </p>
        </motion.div>

        <MotionStagger className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          {TIERS.map((t) => (
            <MotionStaggerItem
              key={t.plan}
              className={`flex flex-col rounded-xl border p-6 ${
                t.highlight
                  ? "border-[color:var(--color-accent)]/40 bg-[var(--color-accent-faint)] ring-1 ring-[color:var(--color-accent)]/15"
                  : "border-[var(--color-border)] bg-[var(--color-surface)]"
              }`}
            >
              <div className="mb-1 flex items-baseline justify-between">
                <h2 className="text-[16px] font-semibold tracking-tight text-[var(--color-fg-strong)]">{t.name}</h2>
                {t.highlight && <Badge tone="accent" size="xs">popular</Badge>}
              </div>
              <p className="mb-6 text-[14px] leading-[1.55] text-[var(--color-fg-muted)]">{t.blurb}</p>
              <div className="mb-6 flex items-baseline gap-1">
                <span className="text-[34px] font-semibold tracking-[-0.02em] text-[var(--color-fg-strong)]">{t.price}</span>
                <span className="text-[14px] text-[var(--color-fg-muted)]">/mo</span>
              </div>
              <ul className="mb-6 flex-1 space-y-2.5 text-[14px] leading-[1.5] text-[var(--color-fg)]">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[var(--color-accent)]" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                variant={t.highlight ? "accent" : (t.plan === "free" ? "secondary" : "primary")}
                size="md"
                onClick={() => handleCta(t.plan)}
                disabled={loadingPlan !== null}
                className="w-full"
              >
                {loadingPlan === t.plan ? "Loading…" : t.cta}
              </Button>
            </MotionStaggerItem>
          ))}
        </MotionStagger>

        {error && (
          <p className="mt-6 text-center text-[14px] text-[color:var(--color-danger)]">{error}</p>
        )}

        <div className="mt-16 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Card density="comfortable">
            <div className="text-[15px] font-semibold tracking-tight text-[var(--color-fg-strong)]">Cancel anytime</div>
            <p className="mt-2 text-[14px] leading-[1.55] text-[var(--color-fg-muted)]">
              One click in your account. No retention popups, no &quot;before you go&quot; flow.
            </p>
          </Card>
          <Card density="comfortable">
            <div className="text-[15px] font-semibold tracking-tight text-[var(--color-fg-strong)]">14-day refund</div>
            <p className="mt-2 text-[14px] leading-[1.55] text-[var(--color-fg-muted)]">
              No questions. Email <a href="mailto:support@stealthscraper.dev" className="text-[var(--color-accent)] hover:underline">support@stealthscraper.dev</a>.
            </p>
          </Card>
          <Card density="comfortable">
            <div className="text-[15px] font-semibold tracking-tight text-[var(--color-fg-strong)]">Quota resets monthly</div>
            <p className="mt-2 text-[14px] leading-[1.55] text-[var(--color-fg-muted)]">
              1st of each month, UTC. See your current usage in <Link href="/settings/usage" className="text-[var(--color-accent)] hover:underline">/settings/usage</Link>.
            </p>
          </Card>
        </div>

        <div className="mt-16">
          <SLABanner variant="feature" />
        </div>

        <div className="mt-16">
          <h2 className="mb-8 text-center text-[26px] font-semibold tracking-tight text-[var(--color-fg-strong)]">
            What people say
          </h2>
          <ReviewBlock targetKind="product" targetId="stealth-scraper" hideHeader limit={6} />
        </div>

        <div className="mt-16 text-center">
          <Link href="/ai-extract" className="inline-flex items-center gap-1 text-[14px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">
            Or try AI extract first <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
