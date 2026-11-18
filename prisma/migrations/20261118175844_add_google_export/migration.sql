-- CreateEnum
CREATE TYPE "GoogleConnectionStatus" AS ENUM ('ACTIVE', 'NEEDS_REAUTH', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "ExportTargetStatus" AS ENUM ('ACTIVE', 'NEEDS_ACTION', 'DISABLED');

-- CreateEnum
CREATE TYPE "ExportMappingStatus" AS ENUM ('EXPORTED', 'DELETED');

-- CreateEnum
CREATE TYPE "ExportJobType" AS ENUM ('SYNC_EVENT', 'FULL_RECONCILE', 'CREATE_CALENDAR');

-- CreateEnum
CREATE TYPE "ExportJobStatus" AS ENUM ('PENDING', 'FAILED');

-- CreateTable
CREATE TABLE "google_connection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleAccountId" TEXT NOT NULL,
    "status" "GoogleConnectionStatus" NOT NULL,
    "encryptedRefreshToken" TEXT,
    "grantedScopes" TEXT NOT NULL,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_export_target" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "googleCalendarId" TEXT,
    "status" "ExportTargetStatus" NOT NULL,
    "lastSuccessfulExportAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_export_target_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_export_mapping" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "exportTargetId" TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "exportedVersion" INTEGER NOT NULL,
    "exportedOccurrences" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ExportMappingStatus" NOT NULL,
    "lastExportedAt" TIMESTAMP(3) NOT NULL,
    "lastError" TEXT,

    CONSTRAINT "event_export_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_job" (
    "id" TEXT NOT NULL,
    "type" "ExportJobType" NOT NULL,
    "exportTargetId" TEXT NOT NULL,
    "eventId" TEXT,
    "status" "ExportJobStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "google_connection_userId_key" ON "google_connection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "google_export_target_connectionId_key" ON "google_export_target"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "event_export_mapping_exportTargetId_eventId_key" ON "event_export_mapping"("exportTargetId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "event_export_mapping_exportTargetId_googleEventId_key" ON "event_export_mapping"("exportTargetId", "googleEventId");

-- CreateIndex
CREATE INDEX "export_job_status_nextAttemptAt_idx" ON "export_job"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "google_connection" ADD CONSTRAINT "google_connection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_export_target" ADD CONSTRAINT "google_export_target_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "google_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_export_mapping" ADD CONSTRAINT "event_export_mapping_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_export_mapping" ADD CONSTRAINT "event_export_mapping_exportTargetId_fkey" FOREIGN KEY ("exportTargetId") REFERENCES "google_export_target"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_job" ADD CONSTRAINT "export_job_exportTargetId_fkey" FOREIGN KEY ("exportTargetId") REFERENCES "google_export_target"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_job" ADD CONSTRAINT "export_job_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CHECK constraints and partial unique indexes Prisma can't express in the schema.

-- An active connection has a token to export with; a disconnected one keeps none.
ALTER TABLE "google_connection" ADD CONSTRAINT "google_connection_token_check" CHECK (
  ("status" = 'ACTIVE' AND "encryptedRefreshToken" IS NOT NULL)
  OR ("status" = 'DISCONNECTED' AND "encryptedRefreshToken" IS NULL)
  OR "status" = 'NEEDS_REAUTH'
);

ALTER TABLE "google_connection" ADD CONSTRAINT "google_connection_account_not_blank_check" CHECK (
  btrim("googleAccountId") <> ''
);

ALTER TABLE "event_export_mapping" ADD CONSTRAINT "event_export_mapping_version_check" CHECK (
  "exportedVersion" >= 1
);

-- A job for one event names it; the other jobs are for the whole target.
ALTER TABLE "export_job" ADD CONSTRAINT "export_job_event_check" CHECK (
  ("type" = 'SYNC_EVENT') = ("eventId" IS NOT NULL)
);

ALTER TABLE "export_job" ADD CONSTRAINT "export_job_attempts_check" CHECK (
  "attemptCount" >= 0
);

-- One job per event and target, and one of each other type per target: a new change
-- merges into the job already there instead of adding another.
CREATE UNIQUE INDEX "export_job_one_per_event_key" ON "export_job"("exportTargetId", "eventId")
  WHERE "eventId" IS NOT NULL;

CREATE UNIQUE INDEX "export_job_one_per_type_key" ON "export_job"("exportTargetId", "type")
  WHERE "eventId" IS NULL;
