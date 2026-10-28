import "server-only";
import { appConfig } from "@/config/app.config";
import { prisma } from "@/lib/prisma";
import { checkUserColor, type ColorCheck } from "./colors";

/** A calendar user as shown to both users: name and color, nothing private. */
export type CalendarUser = {
  configKey: string;
  displayName: string;
  color: string;
};

/**
 * Every user from app.config.ts, in config order, with the color they picked or their
 * default. A user who has not signed in yet has no row and gets the default.
 */
export async function listCalendarUsers(): Promise<CalendarUser[]> {
  const rows = await prisma.user.findMany({ select: { configKey: true, color: true } });
  const picked = new Map(rows.map((row) => [row.configKey, row.color]));
  return appConfig.users.map((user) => ({
    configKey: user.key,
    displayName: user.displayName,
    color: picked.get(user.key) ?? user.defaultColor,
  }));
}

/**
 * The colors a user's color is checked against: every other user's current color,
 * plus the color of shared events. Keyed by the label used in error messages.
 */
export async function otherCalendarColors(
  configKey: string,
  sharedLabel: string,
): Promise<Record<string, string>> {
  const others = (await listCalendarUsers()).filter((user) => user.configKey !== configKey);
  return {
    ...Object.fromEntries(others.map((user) => [user.displayName, user.color])),
    [sharedLabel]: appConfig.sharedColor,
  };
}

/** Validates and saves a user's color. The old color is kept when the check fails. */
export async function updateUserColor(
  userId: string,
  configKey: string,
  color: string,
  sharedLabel: string,
): Promise<ColorCheck> {
  const check = checkUserColor(color, await otherCalendarColors(configKey, sharedLabel));
  if (check.ok) {
    await prisma.user.update({ where: { id: userId }, data: { color: check.color } });
  }
  return check;
}
