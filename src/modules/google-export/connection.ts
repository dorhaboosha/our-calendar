// A user's export connection: saving it when they connect, and its state for settings.

import "server-only";
import { prisma } from "@/lib/prisma";
import { enqueueTargetJob } from "@/modules/jobs/outbox";
import type { GrantedAccess } from "./oauth";
import { encryptToken } from "./token-crypto";

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

/**
 * The export as the settings page shows it:
 * - notConnected: never connected, or disconnected.
 * - needsReauth: Google access was revoked or expired; connect again.
 * - needsAction: the export waits for the user (the calendar was deleted in Google).
 * - exporting: connected, with exports still to do (pending counts them).
 * - upToDate: connected, nothing left to export.
 */
export type ExportState = "notConnected" | "needsReauth" | "needsAction" | "exporting" | "upToDate";

export type ExportStatus = {
  state: ExportState;
  pending: number;
  /** Exports that stopped after failing, until "export again". */
  failed: number;
  lastSuccessfulExportAt: Date | null;
  lastError: string | null;
};

export async function getExportStatus(userId: string): Promise<ExportStatus> {
  const connection = await prisma.googleConnection.findUnique({
    where: { userId },
    include: { target: true },
  });
  const target = connection?.target;
  const none = { pending: 0, failed: 0, lastSuccessfulExportAt: null, lastError: null };
  if (
    !connection ||
    !target ||
    connection.status === "DISCONNECTED" ||
    target.status === "DISABLED"
  ) {
    return { state: "notConnected", ...none };
  }
  const counts = await prisma.exportJob.groupBy({
    by: ["status"],
    where: { exportTargetId: target.id },
    _count: true,
  });
  const count = (status: "PENDING" | "FAILED") =>
    counts.find((row) => row.status === status)?._count ?? 0;
  const state: ExportState =
    connection.status === "NEEDS_REAUTH"
      ? "needsReauth"
      : target.status === "NEEDS_ACTION"
        ? "needsAction"
        : count("PENDING") > 0
          ? "exporting"
          : "upToDate";
  return {
    state,
    pending: count("PENDING"),
    failed: count("FAILED"),
    lastSuccessfulExportAt: target.lastSuccessfulExportAt,
    lastError: connection.status === "NEEDS_REAUTH" ? connection.lastError : target.lastError,
  };
}
