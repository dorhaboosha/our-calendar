import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RETRY_DELAYS_MS, createRefresher, retryDelay } from "./refresh";

describe("retryDelay", () => {
  it("waits longer after each failure in a row, then keeps the longest delay", () => {
    expect([1, 2, 3, 4, 5].map(retryDelay)).toEqual([2_000, 5_000, 10_000, 30_000, 60_000]);
    expect(retryDelay(6)).toBe(60_000);
    expect(retryDelay(100)).toBe(RETRY_DELAYS_MS.at(-1));
  });
});

describe("createRefresher", () => {
  let visible: boolean;
  let refetch: ReturnType<typeof vi.fn<() => void>>;
  let refresher: ReturnType<typeof createRefresher>;

  beforeEach(() => {
    vi.useFakeTimers();
    visible = true;
    refresher = createRefresher(() => visible);
    // Like FullCalendar: refetching starts a load at once.
    refetch = vi.fn(() => refresher.loadStarted());
    refresher.setRefetch(refetch);
  });
  afterEach(() => vi.useRealTimers());

  it("loads again on refresh, but not while a load is under way", () => {
    refresher.refresh();
    refresher.refresh();
    expect(refetch).toHaveBeenCalledTimes(1);
    refresher.loadSucceeded();
    refresher.refresh();
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("tries a failed load again after growing delays, until it works", () => {
    refresher.loadStarted();
    refresher.loadFailed();
    vi.advanceTimersByTime(1_999);
    expect(refetch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refetch).toHaveBeenCalledTimes(1);

    refresher.loadFailed();
    vi.advanceTimersByTime(4_999);
    expect(refetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(refetch).toHaveBeenCalledTimes(2);

    refresher.loadSucceeded();
    vi.advanceTimersByTime(120_000);
    expect(refetch).toHaveBeenCalledTimes(2);

    // A success starts the delays over.
    refresher.loadStarted();
    refresher.loadFailed();
    vi.advanceTimersByTime(2_000);
    expect(refetch).toHaveBeenCalledTimes(3);
  });

  it("doesn't retry while hidden, and a refresh on return replaces a waiting retry", () => {
    refresher.loadStarted();
    refresher.loadFailed();
    refresher.hidden();
    vi.advanceTimersByTime(120_000);
    expect(refetch).not.toHaveBeenCalled();

    visible = false;
    refresher.loadStarted();
    refresher.loadFailed();
    vi.advanceTimersByTime(120_000);
    expect(refetch).not.toHaveBeenCalled();

    visible = true;
    refresher.loadStarted();
    refresher.loadFailed();
    refresher.refresh();
    expect(refetch).toHaveBeenCalledTimes(1);
    refresher.loadSucceeded();
    vi.advanceTimersByTime(120_000);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
