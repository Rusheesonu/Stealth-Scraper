"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Nav } from "@/components/nav";
import { createClient } from "@/lib/supabase/client";

type Plan = "hobby" | "pro" | "business";

const TIERS: {
  plan: Plan;
  name: string;
  price: string;
  features: string[];
  cta: string;
  highlight?: boolean;
}[] = [
  {
    plan: "hobby",
    name: "Hobby",
    price: "$29",
    features: [
      "1,000 scrapes / month",
      "Cloudflare + Datadome unlocked",
      "Saved templates",
      "Email support",
    ],
    cta: "Start Hobby",
  },
  {
    plan: "pro",
    name: "Pro",
    price: "$99",
    features: [
      "10,000 scrapes / month",
      "REST API access",
      "Scheduled runs",
      "Batch URL processing",
      "All Hobby features",
    ],
    cta: "Start Pro",
    highlight: true,
  },
  {
    plan: "business",
    name: "Business",
    price: "$299",
    features: [
      "100,000 scrapes / month",
      "Team seats",
      "Priority support",
      "All Pro features",
    ],
    cta: "Start Business",
  },
];

export default function PricingPage() {
  const [loadingPlan, setLoadingPlan] = useState<Plan | null>(null);
  const [error, setError] = useState("");

  async function handleCheckout(plan: Plan) {
    setLoadingPlan(plan);
    setError("");

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

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
    <main className="min-h-screen">
      <Nav />
      <div className="mx-auto max-w-6xl px-4 pt-16 pb-20">
      <div className="text-center mb-16">
        <h1 className="text-4xl font-semibold mb-4">Pricing</h1>
        <p className="text-zinc-400">
          Pay as you grow. Cancel anytime. 14-day refunds, no questions asked.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {TIERS.map((tier) => (
          <div
            key={tier.plan}
            className={`rounded-xl border p-8 flex flex-col ${
              tier.highlight
                ? "border-emerald-500 bg-emerald-500/5"
                : "border-zinc-800 bg-zinc-900/40"
            }`}
          >
            <h2 className="text-2xl font-semibold mb-1">{tier.name}</h2>
            <div className="mb-6">
              <span className="text-4xl font-semibold">{tier.price}</span>
              <span className="text-zinc-400 ml-1">/ mo</span>
            </div>
            <ul className="space-y-2 mb-8 flex-1 text-sm">
              {tier.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <span className="text-emerald-500 mt-0.5">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <button
              onClick={() => handleCheckout(tier.plan)}
              disabled={loadingPlan !== null}
              className={`rounded-md px-4 py-2.5 text-sm font-medium transition ${
                tier.highlight
                  ? "bg-emerald-500 text-zinc-900 hover:bg-emerald-400"
                  : "bg-white text-zinc-900 hover:bg-zinc-100"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {loadingPlan === tier.plan ? "Loading…" : tier.cta}
            </button>
          </div>
        ))}
      </div>

      {error && (
        <p className="text-center mt-8 text-sm text-red-400">{error}</p>
      )}

      <p className="text-center mt-12 text-xs text-zinc-500">
        Free tier available — sign up to get 100 scrapes/month on soft sites.
      </p>
      </div>
    </main>
  );
}
