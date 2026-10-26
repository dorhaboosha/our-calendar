// The two people allowed to use the app. Their emails come from environment
// variables (USER_EMAIL_<KEY in upper case>), never from code or the database.

import { appConfig } from "@/config/app.config";

type Env = Record<string, string | undefined>;

export function emailEnvVar(userKey: string): string {
  return `USER_EMAIL_${userKey.toUpperCase()}`;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Maps each allowed email to its user key from app.config.ts. Throws on a missing or duplicate email. */
export function getAllowedEmails(env: Env = process.env): Map<string, string> {
  const allowed = new Map<string, string>();
  for (const user of appConfig.users) {
    const name = emailEnvVar(user.key);
    const email = env[name] ? normalizeEmail(env[name]) : "";
    if (!email.includes("@")) {
      throw new Error(`Environment variable ${name} must be set to a Google email`);
    }
    if (allowed.has(email)) {
      throw new Error(`${name} repeats an email that is already assigned to another user`);
    }
    allowed.set(email, user.key);
  }
  return allowed;
}

/** The user key for an allowed email, or undefined when the email may not sign in. */
export function findAllowedUserKey(
  email: string | null | undefined,
  env: Env = process.env,
): string | undefined {
  if (!email) return undefined;
  return getAllowedEmails(env).get(normalizeEmail(email));
}
