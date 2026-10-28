"use server";

import { refresh } from "next/cache";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/modules/auth/current-user";
import { updateUserColor } from "@/modules/users/users";

export type SaveColorResult = { ok: true } | { ok: false; message: string };

/**
 * Saves the signed-in user's color. A user can only change their own color: the user
 * comes from the server-side session, never from the request.
 */
export async function saveMyColor(color: unknown): Promise<SaveColorResult> {
  const user = await requireUser();
  const t = await getTranslations();

  if (typeof color !== "string") {
    return { ok: false, message: t("settings.errors.invalid") };
  }

  const result = await updateUserColor(user.id, user.configKey, color, t("common.shared"));
  if (result.ok) {
    // Re-render the current page so the header and legend show the new color.
    refresh();
    return { ok: true };
  }
  if (result.reason === "tooSimilar") {
    return { ok: false, message: t("settings.errors.tooSimilar", { other: result.conflictWith }) };
  }
  return { ok: false, message: t(`settings.errors.${result.reason}`) };
}
