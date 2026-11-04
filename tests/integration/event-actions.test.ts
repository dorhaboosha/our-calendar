import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/he.json";
import { appConfig } from "@/config/app.config";
import { prisma } from "@/lib/prisma";
import type { CurrentUser } from "@/modules/auth/current-user";

// The server actions the event form calls: the session decides who acts, input is
// validated on the server, and errors come back as Hebrew messages.

let signedIn: CurrentUser | null = null;

vi.mock("@/modules/auth/current-user", () => ({
  requireUser: async () => {
    if (!signedIn) throw new Error("REDIRECT:/login");
    return signedIn;
  },
}));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: "he", messages, namespace: namespace as never }),
  };
});

const { createEventAction, updateEventAction, deleteEventAction } =
  await import("@/app/(app)/event-actions");

const input = {
  title: "Dinner",
  owner: "shared",
  category: "couple",
  isAllDay: false,
  startDate: "2026-11-05",
  endDate: "2026-11-05",
  startTime: "19:00",
  endTime: "21:00",
};

async function signInAs(configKey: "dor" | "maayan") {
  const config = appConfig.users.find((user) => user.key === configKey)!;
  const row = await prisma.user.create({
    data: { id: randomUUID(), name: configKey, email: `${configKey}@example.com`, configKey },
  });
  signedIn = { id: row.id, configKey, displayName: config.displayName, color: config.defaultColor };
  return row;
}

beforeEach(async () => {
  signedIn = null;
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe("event actions", () => {
  it("require a signed-in user and change nothing otherwise", async () => {
    await expect(createEventAction(input)).rejects.toThrow("REDIRECT:/login");
    await expect(updateEventAction(randomUUID(), 1, input)).rejects.toThrow("REDIRECT:/login");
    await expect(deleteEventAction(randomUUID(), 1)).rejects.toThrow("REDIRECT:/login");
    expect(await prisma.event.count()).toBe(0);
  });

  it("create an event as the signed-in user", async () => {
    await signInAs("maayan");
    const result = await createEventAction(input);
    expect(result).toMatchObject({
      ok: true,
      event: { title: "Dinner", owner: "shared", createdBy: "maayan", version: 1 },
    });
  });

  it("ignore any user fields sent in the input", async () => {
    await signInAs("maayan");
    const result = await createEventAction({ ...input, createdBy: "dor", updatedBy: "dor" });
    expect(result).toMatchObject({ ok: true, event: { createdBy: "maayan" } });
  });

  it("return Hebrew messages per field when the input is invalid", async () => {
    await signInAs("dor");
    const result = await createEventAction({ ...input, title: " ", endTime: "18:00" });
    expect(result).toEqual({
      ok: false,
      fieldErrors: { title: messages.events.errors.titleRequired },
    });
    const timing = await createEventAction({ ...input, endTime: "18:00" });
    expect(timing).toEqual({
      ok: false,
      fieldErrors: { endTime: messages.events.errors.endNotAfterStart },
    });
    expect(await prisma.event.count()).toBe(0);
  });

  it("name the user when the owner has never signed in", async () => {
    await signInAs("dor");
    const result = await createEventAction({ ...input, owner: "maayan" });
    expect(result).toEqual({
      ok: false,
      message: "אי אפשר לשייך אירוע למעיין לפני הכניסה הראשונה של מעיין ליומן.",
    });
  });

  it("update and delete, reporting a stale version as a conflict", async () => {
    await signInAs("dor");
    const created = await createEventAction(input);
    if (!created.ok || !("event" in created)) throw new Error("create failed");
    const { id } = created.event;

    const updated = await updateEventAction(id, 1, { ...input, title: "Dinner out" });
    expect(updated).toMatchObject({ ok: true, event: { title: "Dinner out", version: 2 } });
    expect(await updateEventAction(id, 1, input)).toEqual({
      ok: false,
      message: messages.events.errors.conflict,
    });
    expect(await deleteEventAction(id, 2)).toEqual({ ok: true });
    expect(await deleteEventAction(id, 3)).toEqual({
      ok: false,
      message: messages.events.errors.notFound,
    });
  });

  it("reject a malformed id or version without touching the database", async () => {
    await signInAs("dor");
    expect(await updateEventAction(42, 1, input)).toEqual({
      ok: false,
      message: messages.events.errors.notFound,
    });
    expect(await deleteEventAction(randomUUID(), "1")).toEqual({
      ok: false,
      message: messages.events.errors.notFound,
    });
  });
});
