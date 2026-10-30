CREATE TABLE "PostMigrationJob" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "jobKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    -- Prisma compares SQLite DateTimes as epoch milliseconds, not CURRENT_TIMESTAMP text.
    "nextAttemptAt" DATETIME NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    "leaseToken" TEXT,
    "lastError" TEXT,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
);

CREATE INDEX "PostMigrationJob_completedAt_nextAttemptAt_idx"
ON "PostMigrationJob"("completedAt", "nextAttemptAt");

-- SQL records the intent only. Network work starts after ALL migrations succeed and HTTP is
-- listening. A fresh install has no library to refresh; its first setup sync fills it instead.
INSERT OR IGNORE INTO "PostMigrationJob" ("key", "jobKey")
SELECT '20261030200000_refresh_service_metadata', 'full_sync'
WHERE EXISTS (SELECT 1 FROM "Service" WHERE "enabled" = 1 AND "type" IN ('sonarr', 'radarr'));
