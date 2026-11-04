-- CreateTable
CREATE TABLE "shared_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "sharedColor" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shared_settings_pkey" PRIMARY KEY ("id")
);

-- Hand-written (Prisma can't express it): the table holds a single row, id 1.
ALTER TABLE "shared_settings" ADD CONSTRAINT "shared_settings_single_row_check" CHECK ("id" = 1);
