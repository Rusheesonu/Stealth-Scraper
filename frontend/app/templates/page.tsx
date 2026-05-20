import Link from "next/link";
import { PageShell } from "@/components/nav";
import { Button } from "@/components/ui/button";
import { TemplatesList } from "@/components/templates-list";

export default function TemplatesPage() {
  return (
    <PageShell maxWidth="max-w-5xl">
      <div className="py-12">
        <div className="mb-10 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">Library</div>
            <h1 className="text-[28px] font-semibold tracking-[-0.015em] text-[var(--color-fg-strong)]">Templates</h1>
            <p className="mt-2 max-w-xl text-[13px] text-[var(--color-fg-muted)]">
              Saved extraction recipes. Click any to re-run on a new URL with the same structure.
              Publish public to share with the community.
            </p>
          </div>
          <Link href="/pick"><Button variant="primary" size="md">New snapshot →</Button></Link>
        </div>
        <TemplatesList />
      </div>
    </PageShell>
  );
}
