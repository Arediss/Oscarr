-- Availability that reflects the media server, not only the *arr.

-- Last time a library scan actually saw this title. Null = never seen.
ALTER TABLE "Media" ADD COLUMN "libraryConfirmedAt" DATETIME;
CREATE INDEX "Media_libraryConfirmedAt_idx" ON "Media"("libraryConfirmedAt");

-- Which service decides availability, per media type. The default is the *arr, i.e. exactly the
-- historical behaviour — expressed as a value rather than as a special case.
ALTER TABLE "AppSettings" ADD COLUMN "movieAvailabilitySource" TEXT NOT NULL DEFAULT 'radarr';
ALTER TABLE "AppSettings" ADD COLUMN "tvAvailabilitySource" TEXT NOT NULL DEFAULT 'sonarr';

-- Presentation of the IMPORTED state. The state vocabulary itself stays closed.
ALTER TABLE "AppSettings" ADD COLUMN "importedStateLabel" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "importedStateColor" TEXT;

-- Patchnote 0.9.0 seed. Idempotent: ON CONFLICT ("version") DO NOTHING.
INSERT INTO "Patchnote" ("version", "type", "date", "titleEn", "titleFr", "entries") VALUES
('0.9.0', 'minor', '2026-08-08T12:00:00.000Z', 'Availability can now mean "actually on your server"', 'La disponibilité peut enfin vouloir dire « vraiment sur ton serveur »', '[{"type": "feature", "titleEn": "Choose which service decides that a title is available", "titleFr": "Choisis quel service décide qu''un titre est disponible", "descEn": "Until now a title was available the moment Radarr or Sonarr finished downloading. That is right about 98% of the time — but when your library has not been rescanned yet, the user sees \"Available\", hits play, and finds nothing. You can now name your media server as the source of truth instead, separately for movies and series. Only services able to answer are offered.", "descFr": "Jusqu''ici un titre était disponible dès que Radarr ou Sonarr avait fini de télécharger. C''est vrai environ 98 % du temps — mais quand ta bibliothèque n''a pas encore été rescannée, l''utilisateur voit « Disponible », lance la lecture et ne trouve rien. Tu peux désormais désigner ton serveur média comme source de vérité, séparément pour les films et les séries. Seuls les services capables de répondre sont proposés."}, {"type": "feature", "titleEn": "A state for the in-between", "titleFr": "Un état pour l''entre-deux", "descEn": "Media that is downloaded but not yet visible on your server gets its own state instead of lying in either direction. Requesting it again is blocked — it is already here. Its label and colour are yours to set.", "descFr": "Un média téléchargé mais pas encore visible sur ton serveur a désormais son propre état, au lieu de mentir dans un sens ou dans l''autre. Le redemander est bloqué — il est déjà là. Son libellé et sa couleur se règlent."}, {"type": "feature", "titleEn": "Nothing changes unless you ask", "titleFr": "Rien ne change tant que tu ne le demandes pas", "descEn": "The default source stays Radarr and Sonarr, so an upgrade behaves exactly as before.", "descFr": "La source par défaut reste Radarr et Sonarr : après mise à jour, le comportement est strictement identique."}]')
ON CONFLICT ("version") DO NOTHING;
