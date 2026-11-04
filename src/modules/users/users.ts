import "server-only";
import { appConfig } from "@/config/app.config";
import { prisma } from "@/lib/prisma";
import { checkCalendarColor, type ColorCheck } from "./colors";

/** The one row of the shared_settings table. */
const SHARED_SETTINGS_ID = 1;

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

/** The color of shared events: the one picked in settings, or the config default. */
export async function getSharedColor(): Promise<string> {
  const row = await prisma.sharedSettings.findUnique({
    where: { id: SHARED_SETTINGS_ID },
    select: { sharedColor: true },
  });
  return row?.sharedColor ?? appConfig.sharedColor;
}

/**
 * The colors a user's color is checked against: every other user's current color,
 * plus the color of shared events. Keyed by the label used in error messages.
 */
export async function otherCalendarColors(
  configKey: string,
  sharedLabel: string,
): Promise<Record<string, string>> {
  const [users, sharedColor] = await Promise.all([listCalendarUsers(), getSharedColor()]);
  const others = users.filter((user) => user.configKey !== configKey);
  return {
    ...Object.fromEntries(others.map((user) => [user.displayName, user.color])),
    [sharedLabel]: sharedColor,
  };
}

/** The colors the shared color is checked against: every user's current color. */
export async function userCalendarColors(): Promise<Record<string, string>> {
  const users = await listCalendarUsers();
  return Object.fromEntries(users.map((user) => [user.displayName, user.color]));
}

/** Validates and saves a user's color. The old color is kept when the check fails. */
export async function updateUserColor(
  userId: string,
  configKey: string,
  color: string,
  sharedLabel: string,
): Promise<ColorCheck> {
  const check = checkCalendarColor(color, await otherCalendarColors(configKey, sharedLabel));
  if (check.ok) {
    await prisma.user.update({ where: { id: userId }, data: { color: check.color } });
  }
  return check;
}

/**
 * Validates and saves the color of shared events. Either user may change it; it must
 * differ from both users' colors, just as theirs must differ from it.
 */
export async function updateSharedColor(color: string): Promise<ColorCheck> {
  const check = checkCalendarColor(color, await userCalendarColors());
  if (check.ok) {
    await prisma.sharedSettings.upsert({
      where: { id: SHARED_SETTINGS_ID },
      create: { id: SHARED_SETTINGS_ID, sharedColor: check.color },
      update: { sharedColor: check.color },
    });
  }
  return check;
}
