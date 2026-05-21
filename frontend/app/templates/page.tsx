import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/nav";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { TemplatesList } from "@/components/templates-list";

export const metadata: Metadata = {
  title: "Templates",
  description:
    "Your saved extraction recipes. Re-run them on new URLs, publish to the community marketplace, or fork existing ones.",
};

export default function TemplatesPage() {
  return (
    <PageShell maxWidth="max-w-5xl">
      <PageHeader
        eyebrow="Library"
        title="Templates"
        description="Saved extraction recipes. Click any to re-run on a new URL with the same structure. Publish public to share with the community."
        backHref="/"
        backLabel="Home"
        actions={
          <Link href="/pick">
            <Button variant="primary" size="md">New snapshot →</Button>
          </Link>
        }
      />
      <TemplatesList />
    </PageShell>
  );
}
