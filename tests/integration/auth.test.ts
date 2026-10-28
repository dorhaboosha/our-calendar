import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  NOT_ALLOWED,
  assignConfigKey,
  rejectSessionForUnlistedUser,
  rejectUnlistedEmail,
} from "@/modules/auth/hooks";

vi.stubEnv("USER_EMAIL_DOR", "dor@example.com");
vi.stubEnv("USER_EMAIL_MAAYAN", "maayan@example.com");

async function createUser(email: string, configKey: string) {
  return prisma.user.create({ data: { id: randomUUID(), name: configKey, email, configKey } });
}

beforeEach(async () => {
  await prisma.user.deleteMany();
  await prisma.verification.deleteMany();
});

afterAll(async () => {
  await prisma.user.deleteMany();
  await prisma.verification.deleteMany();
  await prisma.$disconnect();
});

describe("rejectUnlistedEmail", () => {
  it("allows the two configured emails", () => {
    expect(rejectUnlistedEmail({ user: { email: "dor@example.com" } })).toBeUndefined();
    expect(rejectUnlistedEmail({ user: { email: "Maayan@Example.com" } })).toBeUndefined();
  });

  it("rejects any other email, or a missing one", () => {
    expect(rejectUnlistedEmail({ user: { email: "stranger@example.com" } })).toEqual({
      error: NOT_ALLOWED,
    });
    expect(rejectUnlistedEmail({ user: {} })).toEqual({ error: NOT_ALLOWED });
  });
});

describe("assignConfigKey", () => {
  it("adds the matching user key to a new user", async () => {
    const result = await assignConfigKey({ email: "maayan@example.com", name: "Maayan" });
    expect(result).toEqual({
      data: { email: "maayan@example.com", name: "Maayan", configKey: "maayan" },
    });
  });

  it("blocks creating a user that is not on the allowlist", async () => {
    expect(await assignConfigKey({ email: "stranger@example.com" })).toBe(false);
  });
});

describe("rejectSessionForUnlistedUser", () => {
  it("allows a session for an allowed user", async () => {
    const dor = await createUser("dor@example.com", "dor");
    expect(await rejectSessionForUnlistedUser({ userId: dor.id })).toBeUndefined();
  });

  it("refuses a session once the user's email is no longer allowed", async () => {
    const old = await createUser("old-address@example.com", "dor");
    expect(await rejectSessionForUnlistedUser({ userId: old.id })).toBe(false);
  });

  it("refuses a session for a user that does not exist", async () => {
    expect(await rejectSessionForUnlistedUser({ userId: randomUUID() })).toBe(false);
  });
});

describe("Better Auth configuration", () => {
  it("has no session without a cookie", async () => {
    const session = await auth.api.getSession({ headers: new Headers() });
    expect(session).toBeNull();
  });

  it("sends sign-in to Google with identity-only scopes and our callback URL", async () => {
    const { url } = await auth.api.signInSocial({
      body: { provider: "google", callbackURL: "/" },
    });
    const authorize = new URL(url!);

    expect(authorize.origin).toBe("https://accounts.google.com");
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      `${process.env.BETTER_AUTH_URL}/api/auth/callback/google`,
    );
    expect(authorize.searchParams.get("scope")?.split(" ").sort()).toEqual([
      "email",
      "openid",
      "profile",
    ]);
    expect(authorize.searchParams.get("prompt")).toBe("select_account");
    expect(authorize.searchParams.get("state")).toBeTruthy();
  });

  it("does not offer email/password sign-up", async () => {
    await expect(
      auth.api.signUpEmail({
        body: { email: "dor@example.com", password: "a-long-password-123", name: "Dor" },
      }),
    ).rejects.toThrow();
    expect(await prisma.user.count()).toBe(0);
  });
});
