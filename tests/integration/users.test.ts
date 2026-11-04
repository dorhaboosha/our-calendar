import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { appConfig } from "@/config/app.config";
import { prisma } from "@/lib/prisma";
import {
  getSharedColor,
  listCalendarUsers,
  otherCalendarColors,
  updateSharedColor,
  updateUserColor,
  userCalendarColors,
} from "@/modules/users/users";

const [dorConfig, maayanConfig] = appConfig.users;
const SHARED = "משותף";

async function createUser(configKey: string, color: string | null = null) {
  return prisma.user.create({
    data: {
      id: randomUUID(),
      name: configKey,
      email: `${configKey}@example.com`,
      configKey,
      color,
    },
  });
}

async function colorOf(id: string) {
  return (await prisma.user.findUniqueOrThrow({ where: { id } })).color;
}

beforeEach(async () => {
  await prisma.user.deleteMany();
  await prisma.sharedSettings.deleteMany();
});

afterAll(async () => {
  await prisma.user.deleteMany();
  await prisma.sharedSettings.deleteMany();
  await prisma.$disconnect();
});

describe("listCalendarUsers", () => {
  it("lists every configured user, with defaults for users who never signed in", async () => {
    await createUser("dor", "#4338ca");
    expect(await listCalendarUsers()).toEqual([
      { configKey: "dor", displayName: dorConfig.displayName, color: "#4338ca" },
      {
        configKey: "maayan",
        displayName: maayanConfig.displayName,
        color: maayanConfig.defaultColor,
      },
    ]);
  });
});

describe("otherCalendarColors", () => {
  it("has the other user's current color and the shared color, but not my own", async () => {
    await createUser("maayan", "#7e22ce");
    expect(await otherCalendarColors("dor", SHARED)).toEqual({
      [maayanConfig.displayName]: "#7e22ce",
      [SHARED]: appConfig.sharedColor,
    });
  });
});

describe("updateUserColor", () => {
  it("saves a valid color, lower-cased", async () => {
    const dor = await createUser("dor");
    expect(await updateUserColor(dor.id, "dor", "#4338CA", SHARED)).toEqual({
      ok: true,
      color: "#4338ca",
    });
    expect(await colorOf(dor.id)).toBe("#4338ca");
  });

  it("refuses a color close to the other user's color and keeps the old one", async () => {
    const dor = await createUser("dor", "#4338ca");
    await createUser("maayan", "#be185d");
    expect(await updateUserColor(dor.id, "dor", "#bf195e", SHARED)).toEqual({
      ok: false,
      reason: "tooSimilar",
      conflictWith: maayanConfig.displayName,
    });
    expect(await colorOf(dor.id)).toBe("#4338ca");
  });

  it("checks against the other user's default when they never signed in", async () => {
    const dor = await createUser("dor");
    const result = await updateUserColor(dor.id, "dor", maayanConfig.defaultColor, SHARED);
    expect(result).toMatchObject({ ok: false, reason: "tooSimilar" });
  });

  it("refuses the shared-events color", async () => {
    const dor = await createUser("dor");
    expect(await updateUserColor(dor.id, "dor", appConfig.sharedColor, SHARED)).toEqual({
      ok: false,
      reason: "tooSimilar",
      conflictWith: SHARED,
    });
  });

  it("refuses a color close to a shared color picked in settings", async () => {
    const dor = await createUser("dor");
    await updateSharedColor("#7e22ce");
    expect(await updateUserColor(dor.id, "dor", "#7f23cf", SHARED)).toEqual({
      ok: false,
      reason: "tooSimilar",
      conflictWith: SHARED,
    });
  });

  it("only changes the given user", async () => {
    const dor = await createUser("dor");
    const maayan = await createUser("maayan", "#7e22ce");
    await updateUserColor(dor.id, "dor", "#4338ca", SHARED);
    expect(await colorOf(maayan.id)).toBe("#7e22ce");
  });
});

describe("shared color", () => {
  it("is the config default until someone picks one", async () => {
    expect(await getSharedColor()).toBe(appConfig.sharedColor);
    expect(await updateSharedColor("#4D7C0F")).toEqual({ ok: true, color: "#4d7c0f" });
    expect(await getSharedColor()).toBe("#4d7c0f");
    // Changing it again updates the same single row.
    await updateSharedColor("#0e7490");
    expect(await getSharedColor()).toBe("#0e7490");
    expect(await prisma.sharedSettings.count()).toBe(1);
  });

  it("is checked against both users' colors, including defaults", async () => {
    await createUser("maayan", "#7e22ce");
    expect(await userCalendarColors()).toEqual({
      [dorConfig.displayName]: dorConfig.defaultColor,
      [maayanConfig.displayName]: "#7e22ce",
    });
    expect(await updateSharedColor("#7f23cf")).toEqual({
      ok: false,
      reason: "tooSimilar",
      conflictWith: maayanConfig.displayName,
    });
    expect(await updateSharedColor(dorConfig.defaultColor)).toMatchObject({
      ok: false,
      conflictWith: dorConfig.displayName,
    });
    expect(await getSharedColor()).toBe(appConfig.sharedColor);
  });

  it("must stand out from the white page", async () => {
    expect(await updateSharedColor("#fef9c3")).toEqual({ ok: false, reason: "tooLight" });
  });

  it("a database constraint keeps settings to a single row", async () => {
    await expect(prisma.sharedSettings.create({ data: { id: 2 } })).rejects.toThrow(
      /shared_settings_single_row_check/,
    );
  });
});
