-- Historical release dates are ISO text. SQLite sorts numeric dates below all text dates,
-- so the millisecond timestamp used by the development seed and 0.10.0 note migration
-- hides the newest release behind older notes (and outside the 15-release API window).
-- Keep their established format without changing any earlier release or migration checksum.
UPDATE "Patchnote"
SET "date" = '2026-10-30T00:00:00.000Z'
WHERE "version" = '0.10.0';
