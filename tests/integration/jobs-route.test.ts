import { afterEach, describe, expect, it, vi } from "vitest";

// The endpoint the periodic trigger calls: only with the shared secret.

const runExportsNow = vi.fn(async () => 3);
vi.mock("@/modules/google-export/trigger", () => ({ runExportsNow }));

const { POST } = await import("@/app/api/jobs/run/route");

const SECRET = "a".repeat(40);
const saved = process.env.CRON_SECRET;

afterEach(() => {
  process.env.CRON_SECRET = saved;
  runExportsNow.mockClear();
});

function call(authorization?: string) {
  return POST(
    new Request("http://localhost:3000/api/jobs/run", {
      method: "POST",
      headers: authorization ? { authorization } : {},
    }),
  );
}

describe("POST /api/jobs/run", () => {
  it("runs the due jobs with the right secret", async () => {
    process.env.CRON_SECRET = SECRET;
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ran: 3 });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(runExportsNow).toHaveBeenCalledOnce();
  });

  it.each([
    ["no header", undefined],
    ["a wrong secret", `Bearer ${"b".repeat(40)}`],
    ["the secret without Bearer", SECRET],
    ["a prefix of the secret", `Bearer ${SECRET.slice(0, 20)}`],
  ])("refuses %s", async (_case, authorization) => {
    process.env.CRON_SECRET = SECRET;
    expect((await call(authorization)).status).toBe(401);
    expect(runExportsNow).not.toHaveBeenCalled();
  });

  it.each([
    ["not set", undefined],
    ["too short to be safe", "short-secret"],
  ])("does nothing while the secret is %s", async (_case, secret) => {
    if (secret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = secret;
    expect((await call(`Bearer ${secret}`)).status).toBe(503);
    expect(runExportsNow).not.toHaveBeenCalled();
  });
});
