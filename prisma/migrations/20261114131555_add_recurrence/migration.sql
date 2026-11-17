-- AlterTable
ALTER TABLE "event" ADD COLUMN     "rrule" TEXT,
ADD COLUMN     "splitFromEventId" TEXT;

-- CreateTable
CREATE TABLE "event_exception" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "originalStartAt" TIMESTAMPTZ(3),
    "originalStartDate" DATE,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT,
    "description" TEXT,
    "location" TEXT,
    "category" TEXT,
    "isAllDay" BOOLEAN,
    "startAt" TIMESTAMPTZ(3),
    "endAt" TIMESTAMPTZ(3),
    "startDate" DATE,
    "endDate" DATE,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_exception_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "event_exception_eventId_originalStartAt_key" ON "event_exception"("eventId", "originalStartAt");

-- CreateIndex
CREATE UNIQUE INDEX "event_exception_eventId_originalStartDate_key" ON "event_exception"("eventId", "originalStartDate");

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_splitFromEventId_fkey" FOREIGN KEY ("splitFromEventId") REFERENCES "event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_exception" ADD CONSTRAINT "event_exception_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_exception" ADD CONSTRAINT "event_exception_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraints Prisma can't express in the schema.

ALTER TABLE "event" ADD CONSTRAINT "event_rrule_not_blank_check" CHECK (
  "rrule" IS NULL OR btrim("rrule") <> ''
);

ALTER TABLE "event" ADD CONSTRAINT "event_not_split_from_itself_check" CHECK (
  "splitFromEventId" <> "id"
);

-- The occurrence is identified by exactly one original start: a timestamp for a timed
-- series, a date for an all-day one. Never both.
ALTER TABLE "event_exception" ADD CONSTRAINT "event_exception_original_start_check" CHECK (
  ("originalStartAt" IS NULL) <> ("originalStartDate" IS NULL)
);

-- Times are overridden all together, in the same shape as an event's: none of them, or
-- exactly the pair matching isAllDay, with the end after the start. IS TRUE / IS FALSE,
-- because a CHECK that comes out NULL (isAllDay NULL with times set) would pass.
ALTER TABLE "event_exception" ADD CONSTRAINT "event_exception_time_check" CHECK (
  ("isAllDay" IS NULL AND "startAt" IS NULL AND "endAt" IS NULL
    AND "startDate" IS NULL AND "endDate" IS NULL)
  OR
  ("isAllDay" IS TRUE AND "startDate" IS NOT NULL AND "endDate" IS NOT NULL
    AND "startAt" IS NULL AND "endAt" IS NULL AND "endDate" > "startDate")
  OR
  ("isAllDay" IS FALSE AND "startAt" IS NOT NULL AND "endAt" IS NOT NULL
    AND "startDate" IS NULL AND "endDate" IS NULL AND "endAt" > "startAt")
);

-- A cancelled occurrence has nothing to override.
ALTER TABLE "event_exception" ADD CONSTRAINT "event_exception_cancelled_check" CHECK (
  NOT "isCancelled" OR ("title" IS NULL AND "description" IS NULL AND "location" IS NULL
    AND "category" IS NULL AND "isAllDay" IS NULL)
);

ALTER TABLE "event_exception" ADD CONSTRAINT "event_exception_title_not_blank_check" CHECK (
  "title" IS NULL OR btrim("title") <> ''
);
