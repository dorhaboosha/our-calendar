// Keeping under Google's per-user request limit (600 a minute, in a sliding window; spec
// 9, docs/free-tier-limits.md). The export runs several jobs at once, so a big full
// export could pass it: Google would refuse requests, and their jobs wait a minute.

/** Requests to Google per user per minute: under Google's 600, with room to spare. */
export const GOOGLE_REQUESTS_PER_MINUTE = 500;

const MINUTE = 60_000;

/**
 * Lets at most `limit` calls start in any `windowMs`: acquire() waits until one may.
 * now and sleep are for tests.
 */
export function slidingWindowLimiter(
  limit: number,
  windowMs = MINUTE,
  {
    now = () => Date.now(),
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  }: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): () => Promise<void> {
  const starts: number[] = [];
  return async function acquire() {
    for (;;) {
      const time = now();
      while (starts.length > 0 && starts[0] <= time - windowMs) starts.shift();
      if (starts.length < limit) {
        starts.push(time);
        return;
      }
      await sleep(starts[0] + windowMs - time);
    }
  };
}
