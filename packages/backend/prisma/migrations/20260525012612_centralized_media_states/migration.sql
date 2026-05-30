-- Centralize media state: add `statusCategory` to Media + Season (backfilled from legacy `status`)
-- and drop `status`. Single migration — never creates `statusKey` nor the MediaStateOption/
-- MediaStateMapping tables (mapping lives in each connector). Backfill is inlined in the copy
-- INSERTs (SQLite RedefineTables) so no existing status info is lost.

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
INSERT INTO "new_Media" ("audioLanguages", "availableAt", "backdropPath", "contentRating", "createdAt", "genres", "id", "keywordIds", "lastEpisodeInfo", "lastMissingSearchAt", "mediaType", "overview", "posterPath", "qualityProfileId", "radarrId", "releaseDate", "sonarrId", "statusCategory", "subtitleLanguages", "title", "tmdbId", "tvdbId", "updatedAt", "voteAverage") SELECT "audioLanguages", "availableAt", "backdropPath", "contentRating", "createdAt", "genres", "id", "keywordIds", "lastEpisodeInfo", "lastMissingSearchAt", "mediaType", "overview", "posterPath", "qualityProfileId", "radarrId", "releaseDate", "sonarrId", CASE "status" WHEN 'unknown' THEN 'UNAVAILABLE' WHEN 'upcoming' THEN 'UPCOMING' WHEN 'searching' THEN 'SEARCHING' WHEN 'pending' THEN 'SEARCHING' WHEN 'processing' THEN 'PROCESSING' WHEN 'available' THEN 'AVAILABLE' WHEN 'deleted' THEN 'UNAVAILABLE' ELSE 'UNAVAILABLE' END, "subtitleLanguages", "title", "tmdbId", "tvdbId", "updatedAt", "voteAverage" FROM "Media";
DROP TABLE "Media";
ALTER TABLE "new_Media" RENAME TO "Media";
CREATE INDEX "Media_tvdbId_idx" ON "Media"("tvdbId");
CREATE INDEX "Media_availableAt_idx" ON "Media"("availableAt");
CREATE INDEX "Media_radarrId_idx" ON "Media"("radarrId");
CREATE INDEX "Media_sonarrId_idx" ON "Media"("sonarrId");
CREATE INDEX "Media_contentRating_idx" ON "Media"("contentRating");
CREATE INDEX "Media_statusCategory_idx" ON "Media"("statusCategory");
CREATE INDEX "Media_statusCategory_availableAt_idx" ON "Media"("statusCategory", "availableAt");
CREATE UNIQUE INDEX "Media_tmdbId_mediaType_key" ON "Media"("tmdbId", "mediaType");
CREATE TABLE "new_Season" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "mediaId" INTEGER NOT NULL,
    "seasonNumber" INTEGER NOT NULL,
    "episodeCount" INTEGER NOT NULL DEFAULT 0,
    "statusCategory" TEXT NOT NULL DEFAULT 'UNAVAILABLE',
    CONSTRAINT "Season_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Season" ("episodeCount", "id", "mediaId", "seasonNumber", "statusCategory") SELECT "episodeCount", "id", "mediaId", "seasonNumber", CASE "status" WHEN 'unknown' THEN 'UNAVAILABLE' WHEN 'pending' THEN 'SEARCHING' WHEN 'processing' THEN 'PROCESSING' WHEN 'available' THEN 'AVAILABLE' ELSE 'UNAVAILABLE' END FROM "Season";
DROP TABLE "Season";
ALTER TABLE "new_Season" RENAME TO "Season";
CREATE UNIQUE INDEX "Season_mediaId_seasonNumber_key" ON "Season"("mediaId", "seasonNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
