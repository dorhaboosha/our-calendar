import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";

function newUser(email: string, configKey: string) {
  return { id: randomUUID(), name: "Test", email, configKey };
}

beforeEach(async () => {
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe("database", () => {
  it("connects to the test database, not the development one", async () => {
    const [row] = await prisma.$queryRaw<{ db: string }[]>`select current_database() as db`;
    expect(row.db).toBe("our_calendar_test");
  });

  it("stores a user with a null color by default", async () => {
    const user = await prisma.user.create({ data: newUser("dor@example.com", "dor") });
    expect(user.color).toBeNull();
    expect(user.emailVerified).toBe(false);
  });

  it("allows only one user per config key", async () => {
    await prisma.user.create({ data: newUser("a@example.com", "dor") });
    await expect(
      prisma.user.create({ data: newUser("b@example.com", "dor") }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("deletes a user's sessions together with the user", async () => {
    const user = await prisma.user.create({ data: newUser("dor@example.com", "dor") });
    await prisma.session.create({
      data: {
        id: randomUUID(),
        token: randomUUID(),
        userId: user.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.session.count()).toBe(0);
  });
});
