// Better Auth hooks that keep the app limited to the two allowed users.
// Kept separate from the Better Auth config so they can be tested directly.

import { prisma } from "@/lib/prisma";
import { findAllowedUserKey } from "./allowlist";

/** Error code Better Auth puts in the redirect (/login?error=not_allowed). */
export const NOT_ALLOWED = "not_allowed";

/**
 * user.validateUserInfo: runs before sign-up, account linking and every Google
 * sign-in, with the email Google returned just now.
 */
export function rejectUnlistedEmail({ user }: { user: { email?: unknown } }) {
  const email = typeof user.email === "string" ? user.email : undefined;
  if (!findAllowedUserKey(email)) {
    return { error: NOT_ALLOWED };
  }
}

/** databaseHooks.user.create.before: link the new user to their entry in app.config.ts. */
export async function assignConfigKey<T extends { email: string }>(user: T) {
  const configKey = findAllowedUserKey(user.email);
  if (!configKey) return false;
  return { data: { ...user, configKey } };
}

/**
 * databaseHooks.session.create.before: refuse a session for a user whose email
 * is no longer on the allowlist (for example after the env var changed).
 */
export async function rejectSessionForUnlistedUser(session: { userId: string }) {
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { email: true },
  });
  if (!findAllowedUserKey(user?.email)) return false;
}
