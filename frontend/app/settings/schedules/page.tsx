"use client";

import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, Power, Trash2, Plus, Clock } from "lucide-react";
import { PageShell } from "@/components/nav";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type ScheduledJob, type SavedTemplate } from "@/lib/api";
import { cn } from "@/lib/utils";

const SCHEDULE_OPTIONS = [
  { value: "*/15 * * * *", label: "Every 15 minutes" },
  { value: "0 * * * *",    label: "Every hour" },
  { value: "0 */6 * * *",  label: "Every 6 hours" },
  { value: "0 9 * * *",    label: "Daily at 9am UTC" },
  { value: "0 0 * * 0",    label: "Weekly · Sunday midnight UTC" },
];

export default function SchedulesPage() {
  const [jobs, setJobs] = useState<ScheduledJob[] | null>(null);
  const [templates, setTemplates] = useState<SavedTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState<number | "">("");
  const [targetUrl, setTargetUrl] = useState("");
  const [scheduleCron, setScheduleCron] = useState(SCHEDULE_OPTIONS[3].value);
  const [webhookUrl, setWebhookUrl] = useState("");

  async function load() {
    try {
      const [j, t] = await Promise.all([api.schedules.list(), api.listTemplates()]);
      setJobs(j); setTemplates(t);
      if (t.length > 0 && templateId === "") setTemplateId(t[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => { void load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !targetUrl.trim() || typeof templateId !== "number") return;
    setCreating(true);
    try {
      await api.schedules.create({
        template_id: templateId, name: name.trim(),
        target_url: targetUrl.trim(), schedule_cron: scheduleCron,
        webhook_url: webhookUrl.trim(),
      });
      setName(""); setTargetUrl(""); setWebhookUrl(""); setShowForm(false);
      await load();
    } catch (e) {
      alert("Create failed: " + (e instanceof Error ? e.message : String(e)));
    } finally { setCreating(false); }
  }

  async function toggle(job: ScheduledJob) {
    try { await api.schedules.toggle(job.id, !job.enabled); await load(); }
    catch (e) { alert("Toggle failed: " + (e instanceof Error ? e.message : String(e))); }
  }

  async function remove(job: ScheduledJob) {
    if (!confirm(`Delete schedule "${job.name}"?`)) return;
    try { await api.schedules.delete(job.id); await load(); }
    catch (e) { alert("Delete failed: " + (e instanceof Error ? e.message : String(e))); }
  }

  const hasTemplates = (templates?.length ?? 0) > 0;

  return (
    <PageShell maxWidth="max-w-4xl">
      <div>
        <PageHeader
          eyebrow="Account · Schedules"
          title="Scheduled scrapes"
          description="Run a saved template on a cron schedule. Optional webhook delivers results to your URL. Each run counts as 1 scrape against your quota."
          backHref="/"
          backLabel="Home"
          actions={hasTemplates && !showForm ? (
            <Button onClick={() => setShowForm(true)} variant="primary" size="md">
              <Plus className="h-3.5 w-3.5" /> New
            </Button>
          ) : undefined}
        />

        {error && (
          <Card density="compact" className="mb-6 border-[color:var(--color-danger)]/30 text-[13px] text-[color:var(--color-danger)]">
            <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" /> {error}
          </Card>
        )}

        {!hasTemplates && !error && templates !== null && (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] p-12 text-center">
            <Clock className="mx-auto mb-3 h-5 w-5 text-[var(--color-fg-subdued)]" />
            <div className="text-[14px] font-medium text-[var(--color-fg)]">You need a saved template first</div>
            <p className="mt-1.5 text-[12px] text-[var(--color-fg-muted)]">
              Schedules run an existing template against a URL on a cron.{" "}
              <a href="/pick" className="text-[var(--color-accent)] hover:underline">Create one →</a>
            </p>
          </div>
        )}

        {!jobs && !error && (
          <div className="flex items-center gap-2 text-[13px] text-[var(--color-fg-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}

        {/* Create form */}
        {showForm && hasTemplates && (
          <Card density="comfortable" className="mb-6">
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Input
                  required
                  placeholder="Schedule name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <select
                  value={templateId}
                  onChange={(e) => setTemplateId(Number(e.target.value))}
                  className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] text-[var(--color-fg)] hover:border-[var(--color-border-strong)] focus-visible:border-[var(--color-fg-strong)] focus-visible:outline-none transition-[border-color] duration-[var(--dur-fast)] ease-[var(--ease-out)]"
                >
                  {templates?.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <Input
                mono required type="url"
                placeholder="https://target-url-to-scrape.com"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
              />
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <select
                  value={scheduleCron}
                  onChange={(e) => setScheduleCron(e.target.value)}
                  className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] text-[var(--color-fg)] hover:border-[var(--color-border-strong)] focus-visible:border-[var(--color-fg-strong)] focus-visible:outline-none transition-[border-color] duration-[var(--dur-fast)] ease-[var(--ease-out)]"
                >
                  {SCHEDULE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <Input
                  mono type="url"
                  placeholder="Webhook URL (optional)"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button type="submit" variant="primary" size="sm" disabled={creating}>
                  {creating ? "Creating…" : "Create schedule"}
                </Button>
              </div>
            </form>
          </Card>
        )}

        {/* List */}
        {jobs && jobs.length === 0 && hasTemplates && !showForm && (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] p-12 text-center">
            <div className="text-[13px] text-[var(--color-fg-muted)]">
              No schedules yet. Click <strong className="text-[var(--color-fg)]">New</strong> above.
            </div>
          </div>
        )}

        {jobs && jobs.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <table className="w-full">
              <thead>
                <tr className="bg-[var(--color-surface)]">
                  <th className="px-4 py-2.5 text-left text-[11px] font-mono font-medium uppercase tracking-wider text-[var(--color-fg-subdued)]">Name</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-mono font-medium uppercase tracking-wider text-[var(--color-fg-subdued)]">Schedule</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-mono font-medium uppercase tracking-wider text-[var(--color-fg-subdued)]">Last run</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-mono font-medium uppercase tracking-wider text-[var(--color-fg-subdued)]"></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const isEnabled = !!j.enabled;
                  return (
                    <tr key={j.id} className={cn("border-t border-[var(--color-border)]", !isEnabled && "opacity-50")}>
                      <td className="px-4 py-3">
                        <div className="text-[13px] font-medium text-[var(--color-fg)]">{j.name}</div>
                        <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--color-fg-muted)]">{j.target_url}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-[var(--color-fg-muted)]">{j.schedule_cron}</td>
                      <td className="px-4 py-3">
                        {j.last_run_at ? (
                          <>
                            <div className="font-mono text-[11px] text-[var(--color-fg)]">{j.last_run_at.slice(0, 16)}</div>
                            <StatusPill status={j.last_status} />
                          </>
                        ) : (
                          <span className="font-mono text-[11px] text-[var(--color-fg-subdued)]">never run</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button onClick={() => toggle(j)} variant="ghost" size="sm">
                          <Power className="h-3 w-3" />
                          {isEnabled ? "Disable" : "Enable"}
                        </Button>
                        <Button onClick={() => remove(j)} variant="danger" size="sm" className="ml-1">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageShell>
  );
}

function StatusPill({ status }: { status: string | null }) {
  if (!status) return null;
  if (status === "ok") return <Badge tone="success" size="xs">ok</Badge>;
  if (status.startsWith("error")) return <Badge tone="danger" size="xs">{status.slice(0, 24)}</Badge>;
  return <Badge tone="warning" size="xs">{status.slice(0, 24)}</Badge>;
}
