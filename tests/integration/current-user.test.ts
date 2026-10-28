import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appConfig } from "@/config/app.config";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, requireUser } from "@/modules/auth/current-user";

// next/headers and next/navigation only work inside a Next.js request.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

const [dorConfig] = appConfig.users;

async function createUser(configKey: string, color: string | null = null) {
  return prisma.user.create({
    data: {
      id: randomUUID(),
      name: "Google name",
      email: `${configKey}@example.com`,
      configKey,
      color,
    },
  });
}

/** Makes Better Auth report the given user as signed in. */
function signIn(user: Awaited<ReturnType<typeof createUser>>) {
  vi.spyOn(auth.api, "getSession").mockResolvedValue({
    user,
    session: { id: randomUUID(), userId: user.id, token: "t", expiresAt: new Date() },
  } as never);
}

beforeEach(async () => {
  await prisma.user.deleteMany();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe("getCurrentUser", () => {
  it("returns null without a session", async () => {
    expect(await getCurrentUser()).toBeNull();
  });

  it("uses the display name from app.config.ts and the default color", async () => {
    const dor = await createUser("dor");
    signIn(dor);
    expect(await getCurrentUser()).toEqual({
      id: dor.id,
      configKey: "dor",
      displayName: dorConfig.displayName,
      color: dorConfig.defaultColor,
    });
  });

  it("uses the color the user picked", async () => {
    signIn(await createUser("dor", "#4338ca"));
    expect((await getCurrentUser())?.color).toBe("#4338ca");
  });

  it("treats a user that is not in app.config.ts as signed out", async () => {
    signIn(await createUser("someone-else"));
    expect(await getCurrentUser()).toBeNull();
  });

  it("returns no email or Google data", async () => {
    signIn(await createUser("dor"));
    expect(Object.keys((await getCurrentUser())!).sort()).toEqual([
      "color",
      "configKey",
      "displayName",
      "id",
    ]);
  });
});

describe("requireUser", () => {
  it("redirects to /login without a session", async () => {
    await expect(requireUser()).rejects.toThrow("REDIRECT:/login");
  });

  it("returns the user when signed in", async () => {
    signIn(await createUser("dor"));
    expect((await requireUser()).configKey).toBe("dor");
  });
});
