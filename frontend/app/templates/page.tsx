import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Brand } from "@/components/brand";
import { TemplatesList } from "@/components/templates-list";

export default function TemplatesPage() {
  return (
    <main className="min-h-screen">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-panel)]/80 px-6 py-4 backdrop-blur">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Brand />
        </div>
        <Link
          href="/"
          className="text-sm text-[var(--color-muted)] hover:text-[var(--color-fg)]"
        >
          New snapshot →
        </Link>
      </header>

      <section className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="mb-2 text-3xl font-semibold tracking-tight">Saved templates</h1>
        <p className="mb-8 text-[var(--color-muted)]">
          Each template is a reusable extraction recipe. Click to re-run on any URL with
          the same structure.
        </p>
        <TemplatesList />
      </section>
    </main>
  );
}
