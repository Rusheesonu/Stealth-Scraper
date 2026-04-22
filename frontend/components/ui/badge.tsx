import { cn } from "@/lib/utils";

export function Badge({
  children,
  className,
  tone = "default",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "default" | "accent" | "danger" | "muted";
}) {
  const tones: Record<string, string> = {
    default: "bg-[var(--color-panel)] text-[var(--color-fg)] border-[var(--color-border)]",
    accent: "bg-emerald-950 text-emerald-300 border-emerald-900",
    danger: "bg-red-950 text-red-300 border-red-900",
    muted: "bg-neutral-900 text-neutral-400 border-neutral-800",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-mono",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
