-- Media.serviceId: which *arr instance radarrId/sonarrId belong to.
-- Plain nullable column, no FK: SQLite can't add one without rebuilding the table, and a stale
-- id is absorbed by the default-instance fallback. Existing rows stay NULL until the next sync.
ALTER TABLE "Media" ADD COLUMN "serviceId" INTEGER;

CREATE INDEX "Media_serviceId_idx" ON "Media"("serviceId");
