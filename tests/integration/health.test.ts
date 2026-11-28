import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// connection() only works inside a Next.js request.
vi.mock("next/server", () => ({ connection: async () => {} }));

const { GET } = await import("@/app/api/health/route");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/health", () => {
  it("answers ok, uncached, without asking the database", async () => {
    const query = vi.spyOn(prisma, "$queryRaw");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
    // Render calls it every few seconds: a query would keep Neon awake.
    expect(query).not.toHaveBeenCalled();
  });
});
