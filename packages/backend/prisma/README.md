# Prisma migrations

## Schema vs. data migrations — choose the right tool

**Schema migrations** (add column, create index, drop table) belong in Prisma Migrate — `npx
prisma migrate dev --name <description>`. They run exactly once per install and are ordered
by filename timestamp.

**Data fixes** (re-normalising existing rows, correcting a mediaType typo, backfilling a new
column for pre-existing data) should NOT be a standalone SQL migration. They're a one-shot
correction that any fresh install will never need, and they bloat the migration history.

Instead, write them as an **idempotent boot-time call** in a seed/repair function. Oscarr
hasn't needed a shared `seed.ts` yet — when the first data-fix after this note lands, put it
in `packages/backend/src/services/seed.ts`, export it, and call it from `bootstrap/*.ts` or
the install flow. Make it idempotent (`WHERE condition AND needs_fix_col IS NULL`, or guarded
by a boolean in `AppSettings`) so restarts don't re-run the fix.

### Precedent to avoid

`20260405100000_fix_anime_rule_mediatype` and `20260405110000_fix_remaining_all_rules` are
both pure data `UPDATE` migrations. They work, but they're the anti-pattern — a fresh install
runs them on an empty table (no-op), and the history carries a business-logic fix forever.

### When to keep a data migration

If the data-fix is **tightly coupled to a schema change in the same PR** (e.g., rename a
column and rewrite its contents in one go), keeping it as a SQL migration is fine. The rule is:
standalone data corrections go in seed; coupled fixes stay in the migration.

### Release notes

Release notes are versioned installation data and use SQL migrations, as requested for
0.10.0. Insert into `Patchnote` with an upsert on `version` to replace development drafts
without changing their ID or other releases. Keep the bilingual document in `docs/releases/`
aligned with the migration. Do not also upsert the same notes from startup code: that would
overwrite the migrated content on every restart. Once shipped, corrections get a new migration.
