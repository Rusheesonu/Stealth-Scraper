import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/nav";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Refund policy",
  description:
    "14-day, no-questions-asked refund on your first paid period. Here's how to request one.",
};

const EFFECTIVE_DATE = "May 22, 2026";

/**
 * Refund policy. Honors the "14-day no questions asked" promise we put on
 * the pricing page. Lives at /refund-policy so links from Lemon Squeezy
 * checkout, footer, and terms all converge on a real page.
 */
export default function RefundPage() {
  return (
    <PageShell maxWidth="max-w-3xl">
      <PageHeader
        eyebrow="Legal"
        title="Refund policy"
        description={
          <>
            14-day, no-questions-asked. Effective {EFFECTIVE_DATE}.
          </>
        }
        backHref="/"
        backLabel="Home"
      />

      <div className="flex flex-col gap-10 text-[16px] leading-[1.65] text-[var(--color-fg)]">
        <Card density="comfortable" className="bg-[var(--color-accent-faint)] border-[var(--color-accent-line)]">
          <div className="text-[16px] font-semibold tracking-tight text-[var(--color-fg-strong)]">
            The promise, in one line.
          </div>
          <p className="mt-2 text-[15px] leading-[1.6] text-[var(--color-fg)]">
            If you&apos;re not happy with Stealth-Scraper within 14 days of
            your first paid charge, email{" "}
            <a
              href="mailto:support@stealthscraper.dev?subject=Refund%20request"
              className="text-[var(--color-accent)] hover:underline"
            >
              support@stealthscraper.dev
            </a>
            {" "}and we&apos;ll refund you in full. No retention popups, no
            &quot;before you go&quot; questions, no friction.
          </p>
        </Card>

        <Section title="What&rsquo;s covered">
          <p>
            The 14-day window applies to your <Strong>first</Strong> paid
            period on any plan — monthly or annual. Subsequent renewals are
            not refundable except where required by local consumer-protection
            law.
          </p>
          <ul>
            <li>Monthly plans: refundable within 14 days of the first charge.</li>
            <li>Annual plans: refundable within 14 days of the first charge.</li>
            <li>
              Upgrades (e.g. Hobby → Pro mid-period): we refund the
              prorated difference if requested within 14 days of the upgrade.
            </li>
            <li>
              Downgrades and cancellations otherwise: you keep access until
              the end of the period you&apos;ve paid for.
            </li>
          </ul>
        </Section>

        <Section title="How to request a refund">
          <p>
            Email{" "}
            <a
              href="mailto:support@stealthscraper.dev?subject=Refund%20request"
              className="text-[var(--color-accent)] hover:underline"
            >
              support@stealthscraper.dev
            </a>
            {" "}from the address on your account. Mention:
          </p>
          <ul>
            <li>The email on the account (so we can match you up).</li>
            <li>The plan and approximate date you signed up.</li>
            <li>
              Optional: what didn&apos;t work. Honestly helps us fix things,
              but we won&apos;t use it as a reason to push back.
            </li>
          </ul>
          <p>
            We respond within 1 business day, usually faster. Lemon Squeezy
            processes the refund to your original payment method — funds
            typically clear in 5-10 business days depending on your bank.
          </p>
        </Section>

        <Section title="When we can&rsquo;t refund">
          <p>
            We will decline a refund only if:
          </p>
          <ul>
            <li>
              You&apos;re outside the 14-day window since your first charge
              and aren&apos;t protected by a local consumer-protection statute
              that says otherwise.
            </li>
            <li>
              You&apos;ve used the service to violate our{" "}
              <Link href="/terms" className="text-[var(--color-accent)] hover:underline">Terms of Service</Link>{" "}
              — particularly Section 3 (acceptable use). Account terminations
              for violations are not refundable.
            </li>
            <li>
              You&apos;re requesting a refund on behalf of a chargeback that&apos;s
              already been opened with your bank — in that case the bank&apos;s
              process governs the outcome.
            </li>
          </ul>
        </Section>

        <Section title="Consumer-protection carve-outs">
          <p>
            Nothing in this policy overrides non-waivable consumer-protection
            rights you have where you live (e.g. EU 14-day distance-selling
            cooling-off, UK Consumer Rights Act, India Consumer Protection
            Act). Where those rules are more generous, they apply.
          </p>
        </Section>

        <div className="border-t border-[var(--color-border)] pt-6 text-[14px] text-[var(--color-fg-muted)]">
          See also:{" "}
          <Link href="/terms" className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:underline">Terms of Service</Link>
          {" · "}
          <Link href="/privacy" className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:underline">Privacy policy</Link>
          {" · "}
          <Link href="/pricing" className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:underline">Pricing</Link>
        </div>
      </div>
    </PageShell>
  );
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[22px] font-semibold tracking-[-0.015em] text-[var(--color-fg-strong)]">
        {title}
      </h2>
      <div className="flex flex-col gap-3 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5 [&_ul]:pl-5 [&_ul]:list-disc [&_li]:marker:text-[var(--color-fg-subdued)]">
        {children}
      </div>
    </section>
  );
}

function Strong({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold text-[var(--color-fg-strong)]">{children}</span>;
}
