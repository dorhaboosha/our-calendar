"use client";

import { useEffect, useState } from "react";

// Loading the events again on return (spec 4.5): when the page becomes visible again
// (a tab, or the installed app coming back from the background), and when the device
// is back online. A failed load is tried again after growing delays, while the page is
// visible, until it works.

/** Delays before each retry of a failed load: the last one repeats. */
export const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000, 60_000] as const;

/** The delay before trying again after this many failed loads in a row (1 or more). */
export function retryDelay(failures: number): number {
  return RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length) - 1];
}

export type Refresher = ReturnType<typeof createRefresher>;

/**
 * When to load again. The calendar reports each load (started, succeeded, failed);
 * refresh() loads the events on screen again, unless a load is already under way, so
 * a return and a reconnection together load once.
 */
export function createRefresher(isVisible: () => boolean) {
  let refetch = () => {};
  let loading = false;
  let failures = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelRetry = () => {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  };
  const refresh = () => {
    cancelRetry();
    if (!loading) refetch();
  };

  return {
    setRefetch(next: () => void) {
      refetch = next;
    },
    refresh,
    /** Hidden: no retries in the background; the return loads again anyway. */
    hidden: cancelRetry,
    loadStarted() {
      loading = true;
    },
    loadSucceeded() {
      loading = false;
      failures = 0;
      cancelRetry();
    },
    loadFailed() {
      loading = false;
      failures++;
      cancelRetry();
      if (isVisible()) retryTimer = setTimeout(refresh, retryDelay(failures));
    },
  };
}

/** A refresher wired to the page's visibility and connection, for the calendar. */
export function useRefreshOnReturn(refetch: () => void): Refresher {
  const [refresher] = useState(() => createRefresher(() => document.visibilityState === "visible"));
  useEffect(() => refresher.setRefetch(refetch), [refresher, refetch]);
  useEffect(() => {
    const onVisibility = () =>
      document.visibilityState === "visible" ? refresher.refresh() : refresher.hidden();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", refresher.refresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", refresher.refresh);
      refresher.hidden();
    };
  }, [refresher]);
  return refresher;
}
