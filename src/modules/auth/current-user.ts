import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getUserConfig } from "@/config/app.config";
import { auth } from "@/lib/auth";

/** The signed-in user, as pages and components need it. No tokens or other secrets. */
export type CurrentUser = {
  id: string;
  configKey: string;
  displayName: string;
  color: string;
};

/** The signed-in user, or null. Validates the session cookie against the database. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const { id, configKey, color } = session.user;
  const config = configKey ? getUserConfig(configKey) : undefined;
  // A user row that no longer matches app.config.ts is treated as signed out.
  if (!config) return null;

  return {
    id,
    configKey: config.key,
    displayName: config.displayName,
    color: color ?? config.defaultColor,
  };
}

/** The server-side authorization check: use it in every protected page, action and route. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
