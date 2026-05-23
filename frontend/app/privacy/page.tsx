import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/nav";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "How Stealth-Scraper collects, stores, and protects your data. Plain-language privacy policy for a solo-founder SaaS.",
};

// Hard-coded effective date — bump this when material terms change.
const EFFECTIVE_DATE = "May 22, 2026";

/**
 * Privacy policy. Plain English, GDPR-aware, no template lawyer-speak.
 * Reflects the actual stack: Supabase (auth + db), Lemon Squeezy (billing),
 * Groq (LLM extraction), Webshare (proxy pool).
 *
 * Founder is India-based — governing law clause sits at the bottom alongside
 * the DPO contact.
 */
export default function PrivacyPage() {
  return (
    <PageShell maxWidth="max-w-3xl">
      <PageHeader
        eyebrow="Legal"
        title="Privacy policy"
        description={
          <>
            How we collect, use, and protect your data. Effective {EFFECTIVE_DATE}.
          </>
        }
        backHref="/"
        backLabel="Home"
      />

      <div className="flex flex-col gap-10 text-[16px] leading-[1.65] text-[var(--color-fg)]">
        <Section title="Who we are">
          <p>
            Stealth-Scraper is operated as a sole proprietorship by Rushikesh Sonu
            (the &quot;founder&quot;, &quot;we&quot;, &quot;us&quot;) from India.
            For any privacy-related question, contact{" "}
            <Mail>support@stealthscraper.dev</Mail>. The founder also acts as
            the data-protection contact (DPO) until we grow large enough to
            need a dedicated one.
          </p>
        </Section>

        <Section title="What we collect">
          <p>We try to collect as little as we can. Specifically:</p>
          <ul>
            <li>
              <Strong>Account data</Strong> — email address, hashed password
              (when you sign up with email), and basic plan/subscription state.
              Email is the only required identifier.
            </li>
            <li>
              <Strong>Scrape activity</Strong> — the URLs you submit, the
              fields you extract, generated templates, and a count of pages
              scraped (for usage and billing).
            </li>
            <li>
              <Strong>Technical logs</Strong> — IP address, user agent, and
              request timestamps. We use these for abuse prevention, rate
              limiting, and debugging — not advertising.
            </li>
            <li>
              <Strong>Payment metadata</Strong> — the last four digits of your
              card and billing country (passed back from Lemon Squeezy). We
              never see or store your full card number.
            </li>
          </ul>
          <p>
            We do <Strong>not</Strong> collect: contacts, location beyond
            country-level, advertising IDs, biometric data, or anything from
            your device that isn&apos;t in the request itself.
          </p>
        </Section>

        <Section title="Cookies">
          <p>
            We use a single category of cookie — a session cookie set by{" "}
            <Strong>Supabase Auth</Strong> so you stay logged in. It expires
            when your session does and contains no advertising or tracking
            payload. We do not use third-party advertising cookies. If we add
            product analytics later (e.g. PostHog), we will update this section
            and surface a clear opt-out before turning it on.
          </p>
        </Section>

        <Section title="Third parties we share data with">
          <p>
            Stealth-Scraper is built on a small set of vetted vendors. They
            each see a narrow slice of your data, only to do their job:
          </p>
          <ul>
            <li>
              <Strong>Supabase</Strong> — authentication and primary database.
              Sees account data and scrape activity.
            </li>
            <li>
              <Strong>Lemon Squeezy</Strong> — payment processing and
              subscription management. Sees billing email and payment metadata.
              Lemon Squeezy is the merchant of record.
            </li>
            <li>
              <Strong>Groq</Strong> — LLM inference for AI-extract. Sees the
              page content you submit to extract from. We pass minimum-viable
              context, not your account identity.
            </li>
            <li>
              <Strong>Webshare</Strong> — residential proxy pool used by some
              snapshots. Sees the destination URL only; not your account.
            </li>
            <li>
              <Strong>Vercel</Strong> — hosts the frontend. Receives request
              metadata (IP, route, status) for delivery.
            </li>
          </ul>
          <p>
            We do not sell, rent, or trade your data. We do not share it with
            advertisers or data brokers. We never will.
          </p>
        </Section>

        <Section title="Your rights">
          <p>
            Regardless of where you live, you can:
          </p>
          <ul>
            <li>
              <Strong>Access</Strong> — request a copy of everything we hold
              on you.
            </li>
            <li>
              <Strong>Correct</Strong> — fix anything that&apos;s wrong.
            </li>
            <li>
              <Strong>Delete</Strong> — wipe your account and associated data.
              Email <Mail>support@stealthscraper.dev</Mail> and we will action
              it within 14 days.
            </li>
            <li>
              <Strong>Port</Strong> — receive your data in a structured,
              machine-readable format (JSON).
            </li>
            <li>
              <Strong>Withdraw consent</Strong> — for anything you opted into.
            </li>
          </ul>
          <p>
            EU/UK/EEA residents additionally have the right to lodge a
            complaint with their local supervisory authority. California
            residents have CCPA rights — we treat the deletion / access /
            opt-out flow above as the channel for both regimes.
          </p>
        </Section>

        <Section title="Data retention">
          <p>
            We hold data only as long as it&apos;s useful:
          </p>
          <ul>
            <li>
              <Strong>Account data</Strong> — until you delete the account.
            </li>
            <li>
              <Strong>Scraped URLs &amp; extracted output</Strong> — 90 days,
              then automatic purge. Templates you explicitly saved are
              retained until you delete them.
            </li>
            <li>
              <Strong>Technical logs</Strong> — 30 days.
            </li>
            <li>
              <Strong>Billing records</Strong> — 7 years, as required by
              applicable tax / financial law.
            </li>
          </ul>
        </Section>

        <Section title="Security">
          <p>
            All traffic uses TLS in transit. Passwords are hashed with
            industry-standard algorithms (Supabase Auth defaults to bcrypt-class).
            Database access is gated by row-level security policies — your
            data is only visible to authenticated requests bound to your
            account. We do not store payment card numbers; Lemon Squeezy
            (PCI-DSS Level 1) handles those.
          </p>
          <p>
            If we ever discover a breach affecting your account, we will
            notify you by email within 72 hours of confirming impact, as
            required by GDPR Article 33-34 standards.
          </p>
        </Section>

        <Section title="International transfers">
          <p>
            Our infrastructure spans the US (Vercel, Supabase, Groq) and EU
            (Supabase regions where selected). We rely on the standard
            contractual clauses these vendors publish to transfer data between
            jurisdictions. If a regulator finds those mechanisms insufficient,
            we will move data closer to home or switch vendors.
          </p>
        </Section>

        <Section title="Children">
          <p>
            Stealth-Scraper is a developer tool. It is not directed at children
            under 16, and we do not knowingly collect data from them. If you
            think a child has signed up, email us and we will delete the
            account.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            We will update this policy when the product evolves. Material
            changes are flagged via email to active subscribers at least 30
            days before they take effect. The effective date at the top of
            this page is the source of truth.
          </p>
        </Section>

        <Section title="Governing law &amp; contact">
          <p>
            This policy is governed by the laws of India. Disputes are
            subject to the exclusive jurisdiction of the courts in Mumbai,
            Maharashtra. None of this overrides any
            non-waivable consumer-protection rights you have where you live.
          </p>
          <p>
            Questions, requests, or anything else — write to{" "}
            <Mail>support@stealthscraper.dev</Mail>. We read every email.
          </p>
        </Section>

        <div className="border-t border-[var(--color-border)] pt-6 text-[14px] text-[var(--color-fg-muted)]">
          See also: <Link href="/terms" className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:underline">Terms of Service</Link>
          {" · "}
          <Link href="/refund-policy" className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:underline">Refund policy</Link>
        </div>
      </div>
    </PageShell>
  );
}

// ── Local primitives (kept here so legal pages stay self-contained) ────

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

function Mail({ children }: { children: string }) {
  return (
    <a
      href={`mailto:${children}`}
      className="text-[var(--color-accent)] hover:underline"
    >
      {children}
    </a>
  );
}

function Strong({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold text-[var(--color-fg-strong)]">{children}</span>;
}
