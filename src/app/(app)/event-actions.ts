"use server";

import { getTranslations } from "next-intl/server";
import { getUserConfig } from "@/config/app.config";
import { requireUser } from "@/modules/auth/current-user";
import {
  type CalendarEvent,
  type EventFailure,
  createEvent,
  deleteEvent,
  updateEvent,
} from "@/modules/events/events";
import { type EventField, validateEvent } from "@/modules/events/validation";

// Create, edit and delete events. Both users may change any event; the acting user
// always comes from the server-side session, never from the request.

export type EventActionResult =
  | { ok: true; event: CalendarEvent }
  /** Per-field messages for the form. */
  | { ok: false; fieldErrors: Partial<Record<EventField, string>> }
  /** A message for the whole form (deleted meanwhile, edited by someone else, ...). */
  | { ok: false; message: string };

export type DeleteEventResult = { ok: true } | { ok: false; message: string };

export async function createEventAction(input: unknown): Promise<EventActionResult> {
  const user = await requireUser();
  const validation = validateEvent(input);
  if (!validation.ok) return fieldErrors(validation.errors);
  const result = await createEvent(validation.draft, user.id);
  return result.ok ? result : failure(result);
}

export async function updateEventAction(
  id: unknown,
  expectedVersion: unknown,
  input: unknown,
): Promise<EventActionResult> {
  const user = await requireUser();
  if (!isId(id) || !isVersion(expectedVersion)) return failure({ ok: false, reason: "notFound" });
  const validation = validateEvent(input);
  if (!validation.ok) return fieldErrors(validation.errors);
  const result = await updateEvent(id, expectedVersion, validation.draft, user.id);
  return result.ok ? result : failure(result);
}

export async function deleteEventAction(
  id: unknown,
  expectedVersion: unknown,
): Promise<DeleteEventResult> {
  const user = await requireUser();
  if (!isId(id) || !isVersion(expectedVersion)) return failure({ ok: false, reason: "notFound" });
  const result = await deleteEvent(id, expectedVersion, user.id);
  return result.ok ? result : failure(result);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}

function isVersion(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1;
}

async function fieldErrors(
  errors: Partial<Record<EventField, string>>,
): Promise<{ ok: false; fieldErrors: Partial<Record<EventField, string>> }> {
  const t = await getTranslations("events.errors");
  return {
    ok: false,
    fieldErrors: Object.fromEntries(
      Object.entries(errors).map(([field, code]) => [field, t(code)]),
    ),
  };
}

async function failure(result: EventFailure): Promise<{ ok: false; message: string }> {
  const t = await getTranslations("events.errors");
  if (result.reason === "ownerNotSignedIn") {
    const name = getUserConfig(result.userKey)?.displayName ?? result.userKey;
    return { ok: false, message: t("ownerNotSignedIn", { name }) };
  }
  return { ok: false, message: t(result.reason) };
}
