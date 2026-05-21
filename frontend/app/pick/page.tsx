import type { Metadata } from "next";
import { Suspense } from "react";
import { PickerClient } from "@/components/picker/picker-client";

export const metadata: Metadata = {
  title: "Pick",
  description:
    "Visual extraction. Load a URL, click the fields you want, and Stealth-Scraper generates a reusable template.",
};

export default function PickPage() {
  return (
    <Suspense fallback={<PickerFallback />}>
      <PickerClient />
    </Suspense>
  );
}

function PickerFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center text-[var(--color-muted)]">
      Loading picker…
    </div>
  );
}
