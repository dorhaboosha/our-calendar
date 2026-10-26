import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/he.json";
import { appConfig } from "@/config/app.config";
import { prisma } from "@/lib/prisma";
import type { CurrentUser } from "@/modules/auth/current-user";

// Who is "signed in" for each test; null means no session.
let signedIn: CurrentUser | null = null;

vi.mock("@/modules/auth/current-user", () => ({
  requireUser: async () => {
    if (!signedIn) throw new Error("REDIRECT:/login");
    return signedIn;
  },
}));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
// The real Hebrew messages, without Next.js's request-bound next-intl setup.
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async () => createTranslator({ locale: "he", messages }),
  };
});

const { saveMyColor } = await import("@/app/(app)/settings/actions");
const { refresh } = await import("next/cache");

const [dorConfig, maayanConfig] = appConfig.users;

async function signInAs(configKey: "dor" | "maayan") {
  const config = configKey === "dor" ? dorConfig : maayanConfig;
  const row = await prisma.user.create({
    data: { id: randomUUID(), name: configKey, email: `${configKey}@example.com`, configKey },
  });
  signedIn = {
    id: row.id,
    configKey,
    displayName: config.displayName,
    color: config.defaultColor,
  };
  return row;
}

beforeEach(async () => {
  signedIn = null;
  vi.mocked(refresh).mockClear();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe("saveMyColor", () => {
  it("requires a signed-in user and changes nothing otherwise", async () => {
    await expect(saveMyColor("#4338ca")).rejects.toThrow("REDIRECT:/login");
  });

  it("saves the color of the signed-in user and refreshes the page", async () => {
    const dor = await signInAs("dor");
    expect(await saveMyColor("#4338ca")).toEqual({ ok: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: dor.id } })).color).toBe("#4338ca");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("returns the Hebrew message naming the conflicting user", async () => {
    await signInAs("dor");
    expect(await saveMyColor(maayanConfig.defaultColor)).toEqual({
      ok: false,
      message: `הצבע דומה מדי לצבע של ${maayanConfig.displayName}. בחרו צבע אחר.`,
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("rejects a color that is too light", async () => {
    await signInAs("dor");
    expect(await saveMyColor("#ffffff")).toEqual({
      ok: false,
      message: messages.settings.errors.tooLight,
    });
  });

  it("rejects values that are not a color string", async () => {
    await signInAs("dor");
    for (const value of [123, null, { color: "#4338ca" }, "javascript:alert(1)"]) {
      expect(await saveMyColor(value)).toEqual({
        ok: false,
        message: messages.settings.errors.invalid,
      });
    }
  });
});
