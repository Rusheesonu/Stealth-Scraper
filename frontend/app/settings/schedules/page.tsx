"use client";

import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, Power, Trash2, Plus } from "lucide-react";
import { Nav } from "@/components/nav";
import { api, type ScheduledJob, type SavedTemplate } from "@/lib/api";

const SCHEDULE_OPTIONS = [
  { value: "*/15 * * * *", label: "Every 15 minutes" },
  { value: "0 * * * *", label: "Every hour" },
  { value: "0 */6 * * *", label: "Every 6 hours" },
  { value: "0 9 * * *", label: "Daily at 9am UTC" },
  { value: "0 0 * * 0", label: "Weekly (Sunday midnight)" },
];

export default function SchedulesPage() {
  const [jobs, setJobs] = useState<ScheduledJob[] | null>(null);
  const [templates, setTemplates] = useState<SavedTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState<number | "">("");
  const [targetUrl, setTargetUrl] = useState("");
  const [scheduleCron, setScheduleCron] = useState(SCHEDULE_OPTIONS[3].value);
  const [webhookUrl, setWebhookUrl] = useState("");

  async function load() {
    try {
      const [j, t] = await Promise.all([api.schedules.list(), api.listTemplates()]);
      setJobs(j);
      setTemplates(t);
      if (t.length > 0 && templateId === "") setTemplateId(t[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !targetUrl.trim() || typeof templateId !== "number") return;
    setCreating(true);
    try {
      await api.schedules.create({
        template_id: templateId,
        name: name.trim(),
        target_url: targetUrl.trim(),
        schedule_cron: scheduleCron,
        webhook_url: webhookUrl.trim(),
      });
      setName("");
      setTargetUrl("");
      setWebhookUrl("");
      setShowForm(false);
      await load();
    } catch (e) {
      alert("Create failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setCreating(false);
    }
  }

  async function toggle(job: ScheduledJob) {
    try {
      await api.schedules.toggle(job.id, !job.enabled);
      await load();
    } catch (e) {
      alert("Toggle failed: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function remove(job: ScheduledJob) {
    if (!confirm(`Delete schedule "${job.name}"?`)) return;
    try {
      await api.schedules.delete(job.id);
      await load();
    } catch (e) {
      alert("Delete failed: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  const hasTemplates = (templates?.length ?? 0) > 0;

  return (
    <main className="min-h-screen">
      <Nav />
      <div className="mx-auto max-w-4xl px-6 py-12">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="mb-2 text-3xl font-semibold tracking-tight">
              Scheduled scrapes
            </h1>
            <p className="text-sm text-[var(--color-muted)]">
              Run a saved template on a cron schedule. Optional webhook delivers
              results to your URL. Each run counts as 1 scrape against your quota.
            </p>
          </div>
          {hasTemplates && !showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3.5 py-2 text-sm font-medium text-zinc-900 hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              New schedule
            </button>
          )}
        </div>

        {error && (
          <div className="mb-6 flex items-center gap-2 rounded-md border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </div>
        )}

        {!hasTemplates && !error && templates !== null && (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] p-12 text-center text-sm text-[var(--color-muted)]">
            You need at least one saved template before you can schedule a run.{" "}
            <a href="/pick" className="text-[var(--color-accent)] hover:underline">
              Create one →
            </a>
          </div>
        )}

        {!jobs && !error && (
          <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        )}

        {/* Create form */}
        {showForm && hasTemplates && (
          <form
            onSubmit={handleCreate}
            className="mb-6 space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]/40 p-5"
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <input
                type="text"
                required
                placeholder="Schedule name (e.g. Daily HN headlines)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm"
              />
              <select
                value={templateId}
                onChange={(e) => setTemplateId(Number(e.target.value))}
                className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm"
              >
                {templates?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <input
                type="url"
                required
                placeholder="Target URL (https://...)"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm md:col-span-2"
              />
              <select
                value={scheduleCron}
                onChange={(e) => setScheduleCron(e.target.value)}
                className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm"
              >
                {SCHEDULE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label} ({o.value})
                  </option>
                ))}
              </select>
              <input
                type="url"
                placeholder="Webhook URL (optional)"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className="rounded-md bg-[var(--color-accent)] px-4 py-1.5 text-xs font-medium text-zinc-900 hover:opacity-90 disabled:opacity-50"
              >
                {creating ? "Creating…" : "Create schedule"}
              </button>
            </div>
          </form>
        )}

        {/* List */}
        {jobs && jobs.length === 0 && hasTemplates && (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] p-12 text-center text-sm text-[var(--color-muted)]">
            No schedules yet. Click <strong className="text-[var(--color-fg)]">New schedule</strong> above.
          </div>
        )}

        {jobs && jobs.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-panel)]/60 text-xs uppercase tracking-wider text-[var(--color-muted)]">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Name</th>
                  <th className="px-4 py-2.5 text-left font-medium">Schedule</th>
                  <th className="px-4 py-2.5 text-left font-medium">Last run</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const isEnabled = !!j.enabled;
                  return (
                    <tr
                      key={j.id}
                      className={`border-t border-[var(--color-border)] ${
                        !isEnabled ? "opacity-50" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium">{j.name}</div>
                        <div className="mt-0.5 truncate font-mono text-xs text-[var(--color-muted)]">
                          {j.target_url}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-[var(--color-muted)]">
                        {j.schedule_cron}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {j.last_run_at ? (
                          <>
                            <div className="text-[var(--color-fg)]">{j.last_run_at}</div>
                            <div className={statusPillClass(j.last_status)}>
                              {j.last_status || "—"}
                            </div>
                          </>
                        ) : (
                          <span className="text-[var(--color-muted)]">never run</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => toggle(j)}
                          className="mr-1 inline-flex items-center gap-1 rounded-md border border-zinc-800 px-2 py-1 text-xs hover:bg-zinc-900"
                        >
                          <Power className="h-3 w-3" />
                          {isEnabled ? "Disable" : "Enable"}
                        </button>
                        <button
                          onClick={() => remove(j)}
                          className="inline-flex items-center gap-1 rounded-md border border-red-900 bg-red-950/30 px-2 py-1 text-xs text-red-200 hover:bg-red-900/50"
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

function statusPillClass(status: string | null): string {
  const base = "mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-mono";
  if (!status) return `${base} bg-zinc-800 text-zinc-400`;
  if (status === "ok") return `${base} bg-emerald-950/60 text-emerald-300`;
  if (status.startsWith("error")) return `${base} bg-red-950/60 text-red-300`;
  return `${base} bg-amber-950/60 text-amber-300`;
}
