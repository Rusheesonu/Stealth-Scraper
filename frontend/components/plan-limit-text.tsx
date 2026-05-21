"use client";

import Link from "next/link";

/**
 * Renders backend error/info strings while turning known relative URLs into
 * real clickable <Link> elements.
 *
 * Why: the backend emits messages like
 *   "You've hit your free plan limit: 52/50 scrapes this month. Upgrade at /pricing."
 * Rendering that as plain text means the user reads "Upgrade at /pricing"
 * and then has to manually type the URL into the address bar — terrible UX
 * for the exact moment we want them to convert.
 *
 * We scan the string for any of the supported paths and rewrap them as
 * styled accent links. Anything else is rendered verbatim, in order.
 *
 * Anti-XSS: we never use dangerouslySetInnerHTML; everything is JSX nodes.
 */

const PATHS = [
  "/pricing",
  "/settings/billing",
  "/settings/usage",
  "/login",
  "/signup",
] as const;

// Compile once, anchored on word boundaries / leading slash + non-word
// terminator so we don't accidentally match the middle of a longer path
// (eg "/pricing-foo" should be left alone).
const PATH_REGEX = new RegExp(
  `(${PATHS.map((p) => p.replace(/\//g, "\\/")).join("|")})(?![\\w-])`,
  "g",
);

type Props = {
  text: string;
  /** Tailwind classes applied to the wrapper. */
  className?: string;
  /** Override the link className (defaults to accent + underline). */
  linkClassName?: string;
};

export function PlanLimitText({ text, className, linkClassName }: Props) {
  if (!text) return null;

  // Split the string into [text, link, text, link, …]. .split with a
  // capturing group keeps the matched delimiters in the resulting array,
  // so we can rebuild as JSX without regex juggling at render time.
  const parts = text.split(PATH_REGEX);

  const linkCls =
    linkClassName ??
    "font-medium text-[var(--color-accent)] hover:underline underline-offset-2";

  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (PATHS.includes(part as (typeof PATHS)[number])) {
          return (
            <Link key={i} href={part} className={linkCls}>
              {part}
            </Link>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}
