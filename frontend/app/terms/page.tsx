import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/nav";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = {
  title: "Terms",
  description:
    "Terms of Service for Stealth-Scraper — acceptable use, billing, refunds, and the legal stuff in plain English.",
};

const EFFECTIVE_DATE = "May 22, 2026";

/**
 * Terms of Service. Real-founder voice — short, direct, no boilerplate
 * about "the Service shall" / "the User hereby". Sections cover the
 * concrete commitments in both directions.
 */
export default function TermsPage() {
  return (
    <PageShell maxWidth="max-w-3xl">
      <PageHeader
        eyebrow="Legal"
        title="Terms of Service"
        description={<>The rules of the road. Effective {EFFECTIVE_DATE}.</>}
        backHref="/"
        backLabel="Home"
      />

      <div className="flex flex-col gap-10 text-[14px] leading-[1.65] text-[var(--color-fg)]">
        <Section title="1. What you&rsquo;re signing up for">
          <p>
            Stealth-Scraper (&quot;the service&quot;) is a web tool that turns
            websites into structured data. You point it at a URL, pick fields
            or describe what you want, and we return JSON. By creating an
            account, accessing the API, or hitting any paid endpoint, you
            agree to these terms.
          </p>
          <p>
            The service is operated by Rushikesh Sonu, a sole proprietorship
            based in India. If you don&apos;t agree to these terms, don&apos;t
            use the service.
          </p>
        </Section>

        <Section title="2. Your account">
          <p>
            You need an account to scrape. You&apos;re responsible for keeping
            your password and API keys safe — if a key leaks, rotate it in{" "}
            <Link href="/settings/api-keys" className="text-[var(--color-accent)] hover:underline">/settings/api-keys</Link>{" "}
            immediately. We&apos;ll honor account lockouts after suspicious
            activity but we can&apos;t recover scrapes done before you reported
            the issue.
          </p>
          <p>
            One account per person. You can&apos;t resell or sublicense your
            seat without written permission.
          </p>
        </Section>

        <Section title="3. Acceptable use">
          <p>
            You agree <Strong>not</Strong> to use the service to:
          </p>
          <ul>
            <li>
              Scrape content you don&apos;t have legal rights to access —
              paywalled material, copyrighted databases, private user data,
              or anything explicitly disallowed by a site&apos;s robots.txt or
              published terms.
            </li>
            <li>
              Harvest personal data (names, emails, phone numbers, addresses,
              government IDs) in jurisdictions where that data is legally
              protected (GDPR, CCPA, India DPDPA, etc.) without a documented
              lawful basis.
            </li>
            <li>
              Target government services, banking portals, medical records,
              court systems, or any infrastructure where unauthorized access
              constitutes a criminal offense.
            </li>
            <li>
              Conduct credit-card or financial fraud, identity theft, or any
              activity that&apos;s illegal in your jurisdiction or ours.
            </li>
            <li>
              Send abusive traffic that would harm the source site &mdash;
              respect rate limits, don&apos;t hammer endpoints, don&apos;t
              evade defenses designed to keep sites online.
            </li>
            <li>
              Build a competing product by mirroring our API, UI, or
              templates wholesale.
            </li>
          </ul>
          <p>
            We reserve the right to suspend or terminate accounts that
            violate this section. Repeated or severe violations are reported
            to the relevant authorities.
          </p>
        </Section>

        <Section title="4. Pricing &amp; auto-renewal">
          <p>
            Paid plans are listed on our{" "}
            <Link href="/pricing" className="text-[var(--color-accent)] hover:underline">pricing page</Link>.
            Subscriptions are billed monthly or annually depending on the
            plan you pick, and they auto-renew until you cancel.
          </p>
          <p>
            Quotas reset on the 1st of each calendar month (UTC). Cancel
            anytime from your account — your access continues until the end
            of the period you&apos;ve already paid for. No partial-month
            refunds, except as covered by the refund policy below.
          </p>
          <p>
            We may change pricing with at least 30 days&apos; notice by email
            to active subscribers. Existing prepaid terms are honored.
          </p>
        </Section>

        <Section title="5. Refunds">
          <p>
            14-day, no-questions-asked refund on your first paid period.
            Full terms on the{" "}
            <Link href="/refund-policy" className="text-[var(--color-accent)] hover:underline">refund policy page</Link>.
          </p>
        </Section>

        <Section title="6. Service availability">
          <p>
            We aim for 99.5% monthly uptime but make no warranty. Scraping
            is inherently dependent on third-party websites — when a target
            site changes structure, blocks our IPs, or goes down, your
            extractions may fail. We work hard to keep templates healthy and
            proxy pools fresh, but we can&apos;t guarantee any specific site
            will be reachable forever.
          </p>
          <p>
            For ongoing status see{" "}
            <Link href="/status" className="text-[var(--color-accent)] hover:underline">/status</Link>.
          </p>
        </Section>

        <Section title="7. Your data &amp; our ownership">
          <p>
            You own the data you extract. We process and store it on your
            behalf per our{" "}
            <Link href="/privacy" className="text-[var(--color-accent)] hover:underline">privacy policy</Link>,
            and you can export or delete it any time.
          </p>
          <p>
            We own the service itself — code, branding, templates we publish
            ourselves, and aggregated/anonymized usage statistics we generate
            to operate and improve it. Public templates you publish to the{" "}
            <Link href="/marketplace" className="text-[var(--color-accent)] hover:underline">marketplace</Link>{" "}
            remain yours, but you grant us a non-exclusive license to host
            and display them.
          </p>
        </Section>

        <Section title="8. Limitation of liability">
          <p>
            To the maximum extent permitted by law, our total liability for
            any claim arising from your use of the service is capped at the
            amount you paid us in the 12 months preceding the claim, or
            US$100, whichever is greater.
          </p>
          <p>
            We are not liable for indirect, incidental, or consequential
            damages — lost revenue, lost data, business interruption — even
            if we&apos;ve been advised they were possible. This cap does not
            apply where local law forbids it (e.g. gross negligence,
            personal injury, or willful misconduct).
          </p>
        </Section>

        <Section title="9. Indemnity">
          <p>
            You agree to defend and indemnify us against claims arising from
            your scrape activity — particularly any third party alleging
            that the data you collected violated their rights. This is the
            quid-pro-quo for us not policing the content of every URL you
            submit.
          </p>
        </Section>

        <Section title="10. Termination">
          <p>
            You can terminate by closing your account from settings or by
            emailing <Mail>support@stealthscraper.dev</Mail>. We can
            terminate for material breach of these terms (especially Section
            3), non-payment, or if we discontinue the service. We&apos;ll
            give 30 days&apos; notice for the latter where reasonable.
          </p>
          <p>
            On termination: you stop using the service; we stop charging
            you; your data is purged per the retention schedule in the
            privacy policy.
          </p>
        </Section>

        <Section title="11. Changes to these terms">
          <p>
            We update these terms when we add features or learn from real
            situations. Material changes are emailed to active subscribers
            at least 30 days before they take effect. The effective date at
            the top of this page is the source of truth.
          </p>
        </Section>

        <Section title="12. Governing law &amp; disputes">
          <p>
            These terms are governed by the laws of India, without regard to
            conflict-of-laws principles. Disputes are subject to the
            exclusive jurisdiction of the courts in Mumbai, Maharashtra.
          </p>
          <p>
            Before filing anything formal, please email{" "}
            <Mail>support@stealthscraper.dev</Mail>. We will respond within
            5 business days and try to resolve it directly — most disputes
            don&apos;t need lawyers, and we&apos;d rather fix the problem
            than litigate it.
          </p>
        </Section>

        <div className="border-t border-[var(--color-border)] pt-6 text-[12px] text-[var(--color-fg-subdued)]">
          See also:{" "}
          <Link href="/privacy" className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:underline">Privacy policy</Link>
          {" · "}
          <Link href="/refund-policy" className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:underline">Refund policy</Link>
        </div>
      </div>
    </PageShell>
  );
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[var(--color-fg-strong)]">
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
