"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** How often the settings page reloads the export's state while it runs. */
export const FOLLOW_INTERVAL_MS = 3_000;

/**
 * While the export runs, reloads the page's data every few seconds, so the number of
 * events left goes down on its own. Only while the page is visible. The page's forms
 * keep what was typed: a refresh only brings new server data.
 */
export function FollowExport({ running }: { running: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, FOLLOW_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [running, router]);
  return null;
}
