import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// connection() only works inside a Next.js request.
vi.mock("next/server", () => ({ connection: async () => {} }));

const { GET } = await import("@/app/api/health/route");

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /api/health", () => {
  it("answers ok when the database is reachable", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("answers 503 without details when the database is unreachable", async () => {
    vi.spyOn(prisma, "$queryRaw").mockRejectedValue(
      new Error("connect ECONNREFUSED db.internal:5432 password=secret"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ status: "error" });
    expect(body).not.toContain("ECONNREFUSED");
  });
});
