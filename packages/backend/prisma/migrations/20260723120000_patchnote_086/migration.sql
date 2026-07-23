-- Patchnote 0.8.6 seed. Idempotent: ON CONFLICT ("version") DO NOTHING.
INSERT INTO "Patchnote" ("version", "type", "date", "titleEn", "titleFr", "entries") VALUES
('0.8.6', 'patch', '2026-07-23T12:00:00.000Z', 'Fix: the Requests page could fail to load', 'Correctif : la page Demandes pouvait ne plus se charger', '[{"type":"fix","titleEn":"Requests page no longer errors out","titleFr":"La page Demandes ne plante plus","descEn":"After the 0.8.5 media-states change, opening your requests could fail with a server error. Fixed.","descFr":"Après la refonte des statuts média en 0.8.5, l''ouverture de tes demandes pouvait échouer avec une erreur serveur. Corrigé."}]')
ON CONFLICT ("version") DO NOTHING;
