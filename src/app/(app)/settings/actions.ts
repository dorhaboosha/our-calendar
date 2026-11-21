"use server";

import { refresh } from "next/cache";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/modules/auth/current-user";
import {
  type ExportActionResult,
  disconnect,
  exportAgain,
} from "@/modules/google-export/connection";
import type { ColorCheck } from "@/modules/users/colors";
import { updateSharedColor, updateUserColor } from "@/modules/users/users";

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

  return toResult(await updateUserColor(user.id, user.configKey, color, t("common.shared")));
}

/** Saves the color of shared events. Either user may change it. */
export async function saveSharedColor(color: unknown): Promise<SaveColorResult> {
  await requireUser();
  const t = await getTranslations();

  if (typeof color !== "string") {
    return { ok: false, message: t("settings.errors.invalid") };
  }

  return toResult(await updateSharedColor(color));
}

async function toResult(check: ColorCheck): Promise<SaveColorResult> {
  if (check.ok) {
    // Re-render the current page so the header, legend and settings show the new color.
    refresh();
    return { ok: true };
  }
  const t = await getTranslations();
  if (check.reason === "tooSimilar") {
    return { ok: false, message: t("settings.errors.tooSimilar", { other: check.conflictWith }) };
  }
  return { ok: false, message: t(`settings.errors.${check.reason}`) };
}

export type GoogleActionResult = { ok: boolean; message: string };

/**
 * "Export again" of the signed-in user's own export (after the calendar was deleted in
 * Google, it is created again first). The user comes from the session, never the request.
 */
export async function exportToGoogleAgain(): Promise<GoogleActionResult> {
  const user = await requireUser();
  return googleResult(await exportAgain(user.id), "exportAgainDone");
}

/** Disconnects the signed-in user's export, deleting the calendar in Google or not. */
export async function disconnectGoogle(deleteCalendar: unknown): Promise<GoogleActionResult> {
  const user = await requireUser();
  if (typeof deleteCalendar !== "boolean") {
    const t = await getTranslations("settings.googleExport");
    return { ok: false, message: t("actions.errors.invalid") };
  }
  return googleResult(
    await disconnect(user.id, { deleteCalendar }),
    deleteCalendar ? "disconnectedDeleted" : "disconnectedKept",
  );
}

async function googleResult(
  result: ExportActionResult,
  done: "exportAgainDone" | "disconnectedDeleted" | "disconnectedKept",
): Promise<GoogleActionResult> {
  const t = await getTranslations("settings.googleExport");
  if (!result.ok) return { ok: false, message: t(`actions.errors.${result.reason}`) };
  // Re-render the page so the export's state (and the header) are current.
  refresh();
  return { ok: true, message: t(`actions.${done}`) };
}
