-- CreateEnum
CREATE TYPE "EventOwnerType" AS ENUM ('USER', 'SHARED');

-- CreateTable
CREATE TABLE "event" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "ownerType" "EventOwnerType" NOT NULL,
    "ownerUserId" TEXT,
    "category" TEXT NOT NULL,
    "isAllDay" BOOLEAN NOT NULL,
    "startAt" TIMESTAMPTZ(3),
    "endAt" TIMESTAMPTZ(3),
    "startDate" DATE,
    "endDate" DATE,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_startAt_endAt_idx" ON "event"("startAt", "endAt");

-- CreateIndex
CREATE INDEX "event_startDate_endDate_idx" ON "event"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "event_ownerUserId_idx" ON "event"("ownerUserId");

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraints Prisma can't express in the schema.

-- Exactly one pair of time columns, matching isAllDay. Never a date mixed with a timestamp.
ALTER TABLE "event" ADD CONSTRAINT "event_time_kind_check" CHECK (
  ("isAllDay" AND "startDate" IS NOT NULL AND "endDate" IS NOT NULL
    AND "startAt" IS NULL AND "endAt" IS NULL)
  OR
  (NOT "isAllDay" AND "startAt" IS NOT NULL AND "endAt" IS NOT NULL
    AND "startDate" IS NULL AND "endDate" IS NULL)
);

-- The end is after the start. All-day endDate is exclusive, so a one-day event has
-- endDate = startDate + 1.
ALTER TABLE "event" ADD CONSTRAINT "event_end_after_start_check" CHECK (
  ("isAllDay" AND "endDate" > "startDate") OR (NOT "isAllDay" AND "endAt" > "startAt")
);

-- A personal event has an owner; a shared event has none.
ALTER TABLE "event" ADD CONSTRAINT "event_owner_check" CHECK (
  ("ownerType" = 'USER' AND "ownerUserId" IS NOT NULL)
  OR ("ownerType" = 'SHARED' AND "ownerUserId" IS NULL)
);

ALTER TABLE "event" ADD CONSTRAINT "event_title_not_blank_check" CHECK (btrim("title") <> '');

ALTER TABLE "event" ADD CONSTRAINT "event_version_positive_check" CHECK ("version" >= 1);
