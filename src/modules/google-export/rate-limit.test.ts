import { describe, expect, it, vi } from "vitest";
import { slidingWindowLimiter } from "./rate-limit";

describe("slidingWindowLimiter", () => {
  it("lets calls through up to the limit, then waits until the oldest leaves the window", async () => {
    let time = 0;
    const waits: number[] = [];
    const acquire = slidingWindowLimiter(3, 1000, {
      now: () => time,
      sleep: async (ms) => {
        waits.push(ms);
        time += ms;
      },
    });
    await acquire();
    time = 100;
    await acquire();
    time = 200;
    await acquire();
    expect(waits).toEqual([]);

    // The fourth waits until the first one (at 0) is a second old.
    time = 300;
    await acquire();
    expect(waits).toEqual([700]);
    expect(time).toBe(1000);

    // Later, the window has room again.
    time = 5000;
    await acquire();
    expect(waits).toEqual([700]);
  });

  it("calls waiting at once each get their own turn", async () => {
    vi.useFakeTimers();
    try {
      const acquire = slidingWindowLimiter(2, 1000);
      const t0 = Date.now();
      const started: number[] = [];
      for (let index = 0; index < 5; index++) {
        void acquire().then(() => started.push(Date.now() - t0));
      }
      await vi.advanceTimersByTimeAsync(3000);
      expect(started).toEqual([0, 0, 1000, 1000, 2000]);
    } finally {
      vi.useRealTimers();
    }
  });
});
