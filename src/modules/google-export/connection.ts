// A user's export connection: saving it when they connect, and its state for settings.

import "server-only";
import { prisma } from "@/lib/prisma";
import { enqueueTargetJob } from "@/modules/jobs/outbox";
import type { ApiFor } from "./export-jobs";
import { GoogleApiError, isFailure } from "./google-api";
import { googleApiFor } from "./google-client";
import { type GrantedAccess, revokeToken } from "./oauth";
import { decryptToken, encryptToken } from "./token-crypto";

/** How connecting ended, shown on the settings page (?google=...). */
export const CONNECT_RESULTS = ["connected", "denied", "missingScope", "failed"] as const;
export type ConnectResult = (typeof CONNECT_RESULTS)[number];

/**
 * Saves the access a user just granted, and starts the export: the calendar is created
 * (or, connecting again with the same Google account, the existing one is kept) and
 * every event is exported. Connecting another Google account starts over in a new
 * calendar there.
 */
export async function saveConnection(userId: string, access: GrantedAccess, now = new Date()) {
  const connectionData = {
    googleAccountId: access.googleAccountId,
    status: "ACTIVE" as const,
    encryptedRefreshToken: encryptToken(access.refreshToken, userId),
    grantedScopes: access.grantedScopes,
    lastError: null,
  };
  await prisma.$transaction(async (tx) => {
    const previous = await tx.googleConnection.findUnique({
      where: { userId },
      include: { target: true },
    });
    const connection = await tx.googleConnection.upsert({
      where: { userId },
      create: { userId, ...connectionData },
      update: connectionData,
    });
    const sameAccount = previous?.googleAccountId === access.googleAccountId;
    const target = await tx.googleExportTarget.upsert({
      where: { connectionId: connection.id },
      create: { connectionId: connection.id, status: "ACTIVE" },
      update: {
        status: "ACTIVE",
        lastError: null,
        ...(!sameAccount && { googleCalendarId: null, lastSuccessfulExportAt: null }),
      },
    });
    if (!sameAccount && previous?.target) {
      await tx.eventExportMapping.deleteMany({ where: { exportTargetId: target.id } });
    }
    await enqueueTargetJob(tx, target.id, "CREATE_CALENDAR", now);
  });
}

export type ExportActionResult =
  { ok: true } | { ok: false; reason: "notConnected" | "needsReauth" | "deleteFailed" };

/** The user's connection with its target, unless never connected or disconnected. */
async function currentConnection(userId: string) {
  const connection = await prisma.googleConnection.findUnique({
    where: { userId },
    include: { target: true },
  });
  return connection && connection.status !== "DISCONNECTED" ? connection : null;
}

/**
 * "Export again": every event is sent to Google again, which also undoes changes made
 * there by hand to an event, or brings it back if deleted. Not one occurrence of a
 * series changed by hand there: nothing is read from Google, and only occurrences
 * changed in the app are sent. After the calendar was deleted in Google, it is created
 * again (empty) first. Not while the access has to be granted again.
 */
export async function exportAgain(userId: string): Promise<ExportActionResult> {
  const connection = await currentConnection(userId);
  const target = connection?.target;
  if (!connection || !target || target.status === "DISABLED") {
    return { ok: false, reason: "notConnected" };
  }
  if (connection.status === "NEEDS_REAUTH") return { ok: false, reason: "needsReauth" };
  await prisma.$transaction(async (tx) => {
    await tx.googleExportTarget.update({
      where: { id: target.id },
      data: { status: "ACTIVE", lastError: null },
    });
    // Checks the calendar is still there (creating it again if not), then exports all.
    await enqueueTargetJob(tx, target.id, "CREATE_CALENDAR");
  });
  return { ok: true };
}

/**
 * Disconnects the export: optionally deletes the calendar in Google, revokes the access,
 * and stops exporting. Events in the app are untouched. A calendar that is kept stays in
 * Google as it is, and connecting the same account again picks it up.
 *
 * Revoking ends the app's whole grant in that Google account, which signing in shares
 * (one OAuth client); the session in the app goes on, and the next sign-in asks Google's
 * consent again. A failed revoke doesn't stop the disconnect: the token is deleted here
 * either way, and the user can remove the app in their Google account.
 */
export async function disconnect(
  userId: string,
  { deleteCalendar }: { deleteCalendar: boolean },
  {
    apiFor = googleApiFor,
    revoke = revokeToken,
  }: { apiFor?: ApiFor; revoke?: typeof revokeToken } = {},
): Promise<ExportActionResult> {
  const connection = await currentConnection(userId);
  if (!connection) return { ok: false, reason: "notConnected" };
  const target = connection.target;
  const calendarId = target?.googleCalendarId;

  if (deleteCalendar && calendarId) {
    if (connection.status !== "ACTIVE") return { ok: false, reason: "needsReauth" };
    try {
      await apiFor(connection).deleteCalendar(calendarId);
    } catch (error) {
      if (!isFailure(error, "notFound", "gone")) {
        console.error("Deleting the Google calendar failed:", describe(error));
        return { ok: false, reason: "deleteFailed" };
      }
    }
  }

  if (connection.encryptedRefreshToken) {
    try {
      await revoke(decryptToken(connection.encryptedRefreshToken, userId));
    } catch (error) {
      console.error("Revoking Google access failed:", describe(error));
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.googleConnection.update({
      where: { id: connection.id },
      data: { status: "DISCONNECTED", encryptedRefreshToken: null, lastError: null },
    });
    if (!target) return;
    await tx.exportJob.deleteMany({ where: { exportTargetId: target.id } });
    await tx.googleExportTarget.update({
      where: { id: target.id },
      data: {
        status: "DISABLED",
        lastError: null,
        ...(deleteCalendar && { googleCalendarId: null, lastSuccessfulExportAt: null }),
      },
    });
    if (deleteCalendar) {
      await tx.eventExportMapping.deleteMany({ where: { exportTargetId: target.id } });
    }
  });
  return { ok: true };
}

/** For the log: the Google status and reason, never a token or Google's message. */
const describe = (error: unknown) =>
  error instanceof GoogleApiError ? error.message : "unexpected";

/** Whether the header should point the user to settings: the export waits for them. */
export async function exportNeedsAction(userId: string): Promise<boolean> {
  const connection = await currentConnection(userId);
  return connection?.status === "NEEDS_REAUTH" || connection?.target?.status === "NEEDS_ACTION";
}

/**
 * The export as the settings page shows it:
 * - notConnected: never connected, or disconnected.
 * - needsReauth: Google access was revoked or expired; connect again.
 * - needsAction: the export waits for the user (the calendar was deleted in Google).
 * - exporting: connected, with exports still to do (pending counts them).
 * - someFailed: connected, nothing left to do, but some exports stopped after failing.
 * - upToDate: connected, everything exported.
 */
export type ExportState =
  "notConnected" | "needsReauth" | "needsAction" | "exporting" | "someFailed" | "upToDate";

export type ExportStatus = {
  state: ExportState;
  pending: number;
  /** Events still to export, for the progress shown while exporting. */
  pendingEvents: number;
  /**
   * Whether jobs are due now, so the export is running (or about to): not only retries
   * waiting for later. The settings page follows the progress while it is.
   */
  running: boolean;
  /** Events whose export stopped after failing, until "export again". */
  failed: number;
  /**
   * Whether a job for the whole calendar stopped after failing: creating the calendar
   * (there is none yet), or the full export.
   */
  setupFailed: "calendar" | "fullExport" | null;
  lastSuccessfulExportAt: Date | null;
  lastError: string | null;
  /** Disconnecting can delete the calendar: it exists, and the access still works. */
  canDeleteCalendar: boolean;
};

export async function getExportStatus(userId: string, now = new Date()): Promise<ExportStatus> {
  const connection = await prisma.googleConnection.findUnique({
    where: { userId },
    include: { target: true },
  });
  const target = connection?.target;
  const none = {
    pending: 0,
    pendingEvents: 0,
    running: false,
    failed: 0,
    setupFailed: null,
    lastSuccessfulExportAt: null,
    lastError: null,
    canDeleteCalendar: false,
  };
  if (
    !connection ||
    !target ||
    connection.status === "DISCONNECTED" ||
    target.status === "DISABLED"
  ) {
    return { state: "notConnected", ...none };
  }
  const [counts, due] = await Promise.all([
    prisma.exportJob.groupBy({
      by: ["status", "type"],
      where: { exportTargetId: target.id },
      _count: true,
    }),
    prisma.exportJob.count({
      where: { exportTargetId: target.id, status: "PENDING", nextAttemptAt: { lte: now } },
    }),
  ]);
  const count = (status: "PENDING" | "FAILED", types?: string[]) =>
    counts
      .filter((row) => row.status === status && (!types || types.includes(row.type)))
      .reduce((sum, row) => sum + row._count, 0);
  const pending = count("PENDING");
  const pendingEvents = count("PENDING", ["SYNC_EVENT"]);
  const failed = count("FAILED", ["SYNC_EVENT"]);
  const setupFailed =
    count("FAILED", ["CREATE_CALENDAR", "FULL_RECONCILE"]) === 0
      ? null
      : target.googleCalendarId
        ? "fullExport"
        : "calendar";
  const state: ExportState =
    connection.status === "NEEDS_REAUTH"
      ? "needsReauth"
      : target.status === "NEEDS_ACTION"
        ? "needsAction"
        : pending > 0
          ? "exporting"
          : failed > 0 || setupFailed
            ? "someFailed"
            : "upToDate";
  return {
    state,
    pending,
    pendingEvents,
    running: state === "exporting" && due > 0,
    failed,
    setupFailed,
    lastSuccessfulExportAt: target.lastSuccessfulExportAt,
    lastError: connection.status === "NEEDS_REAUTH" ? connection.lastError : target.lastError,
    canDeleteCalendar:
      connection.status === "ACTIVE" &&
      target.status === "ACTIVE" &&
      target.googleCalendarId !== null,
  };
}
