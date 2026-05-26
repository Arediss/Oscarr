-- CreateTable
CREATE TABLE "MediaStateOption" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "colorToken" TEXT NOT NULL,
    "iconName" TEXT NOT NULL,
    "showsRequestCTA" BOOLEAN NOT NULL DEFAULT false,
    "seerrCode" INTEGER NOT NULL,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "isFallback" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MediaStateMapping" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "mediaStateOptionId" INTEGER NOT NULL,
    "serviceType" TEXT NOT NULL,
    "matchArrStatus" TEXT,
    "matchMonitored" BOOLEAN,
    "matchHasFile" BOOLEAN,
    "matchInActiveQueue" BOOLEAN,
    "priority" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "MediaStateMapping_mediaStateOptionId_fkey" FOREIGN KEY ("mediaStateOptionId") REFERENCES "MediaStateOption" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Media" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tmdbId" INTEGER NOT NULL,
    "tvdbId" INTEGER,
    "mediaType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "overview" TEXT,
    "posterPath" TEXT,
    "backdropPath" TEXT,
    "releaseDate" TEXT,
    "voteAverage" REAL,
    "genres" TEXT,
    "keywordIds" TEXT,
    "contentRating" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "statusKey" TEXT NOT NULL DEFAULT 'unknown',
    "statusCategory" TEXT NOT NULL DEFAULT 'UNAVAILABLE',
    "radarrId" INTEGER,
    "sonarrId" INTEGER,
    "qualityProfileId" INTEGER,
    "availableAt" DATETIME,
    "lastMissingSearchAt" DATETIME,
    "lastEpisodeInfo" TEXT,
    "audioLanguages" TEXT,
    "subtitleLanguages" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Media" ("audioLanguages", "availableAt", "backdropPath", "contentRating", "createdAt", "genres", "id", "keywordIds", "lastEpisodeInfo", "lastMissingSearchAt", "mediaType", "overview", "posterPath", "qualityProfileId", "radarrId", "releaseDate", "sonarrId", "status", "subtitleLanguages", "title", "tmdbId", "tvdbId", "updatedAt", "voteAverage") SELECT "audioLanguages", "availableAt", "backdropPath", "contentRating", "createdAt", "genres", "id", "keywordIds", "lastEpisodeInfo", "lastMissingSearchAt", "mediaType", "overview", "posterPath", "qualityProfileId", "radarrId", "releaseDate", "sonarrId", "status", "subtitleLanguages", "title", "tmdbId", "tvdbId", "updatedAt", "voteAverage" FROM "Media";
DROP TABLE "Media";
ALTER TABLE "new_Media" RENAME TO "Media";
CREATE INDEX "Media_tvdbId_idx" ON "Media"("tvdbId");
CREATE INDEX "Media_status_idx" ON "Media"("status");
CREATE INDEX "Media_availableAt_idx" ON "Media"("availableAt");
CREATE INDEX "Media_radarrId_idx" ON "Media"("radarrId");
CREATE INDEX "Media_sonarrId_idx" ON "Media"("sonarrId");
CREATE INDEX "Media_contentRating_idx" ON "Media"("contentRating");
CREATE INDEX "Media_status_availableAt_idx" ON "Media"("status", "availableAt");
CREATE INDEX "Media_statusCategory_idx" ON "Media"("statusCategory");
CREATE INDEX "Media_statusCategory_availableAt_idx" ON "Media"("statusCategory", "availableAt");
CREATE UNIQUE INDEX "Media_tmdbId_mediaType_key" ON "Media"("tmdbId", "mediaType");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "MediaStateOption_key_key" ON "MediaStateOption"("key");

-- CreateIndex
CREATE INDEX "MediaStateMapping_serviceType_priority_idx" ON "MediaStateMapping"("serviceType", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "MediaStateMapping_serviceType_matchArrStatus_matchMonitored_matchHasFile_matchInActiveQueue_key" ON "MediaStateMapping"("serviceType", "matchArrStatus", "matchMonitored", "matchHasFile", "matchInActiveQueue");

-- Partial unique index: at most one MediaStateOption row may have isFallback = true.
-- SQLite supports partial indexes; Prisma's schema language doesn't, so this is appended manually.
CREATE UNIQUE INDEX "MediaStateOption_isFallback_unique" ON "MediaStateOption"("isFallback") WHERE "isFallback" = 1;

-- Backfill Media.statusKey from the legacy Media.status (1:1 carry-over).
UPDATE "Media" SET "statusKey" = "status" WHERE "statusKey" = 'unknown';

-- Deterministic mapping of the legacy Media.status to the closed MediaStateCategory enum.
-- 'pending' folds into SEARCHING (Sonarr-monitored-no-files semantics).
-- 'deleted' folds into UNAVAILABLE (the value is reserved/unused).
UPDATE "Media" SET "statusCategory" = CASE "status"
  WHEN 'unknown'    THEN 'UNAVAILABLE'
  WHEN 'pending'    THEN 'SEARCHING'
  WHEN 'upcoming'   THEN 'UPCOMING'
  WHEN 'searching'  THEN 'SEARCHING'
  WHEN 'processing' THEN 'PROCESSING'
  WHEN 'available'  THEN 'AVAILABLE'
  WHEN 'deleted'    THEN 'UNAVAILABLE'
  ELSE 'UNAVAILABLE'
END WHERE "statusCategory" = 'UNAVAILABLE';
