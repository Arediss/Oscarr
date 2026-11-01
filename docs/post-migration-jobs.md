# Work after SQL migrations

SQL migrations may enqueue an idempotent application job in `PostMigrationJob`. They never
call an HTTP service or run a job inside the migration transaction.

Boot applies **all** pending Prisma migrations before registering routes. After the HTTP
server is listening and the scheduler definitions are seeded, the scheduler drains this
queue in the background. A failed SQL migration aborts boot before this worker starts.
Restoring an older backup follows the same migration-then-worker order.

## Service metadata refresh

`20261030200000_post_migration_jobs` queues `full_sync` when an enabled Sonarr or Radarr
instance already exists. A fresh installation does not need this upgrade job: its first
configured library sync populates the database normally.

The refresh uses the existing library sync across **all enabled instances**:

- Replaces persisted season rows with the native Sonarr seasons, including removing old
  season numbers. Replacement is transactional; a failed write retains the previous seasons.
- Keeps users, configuration, media identities and request records. Existing request status
  updates still follow the normal availability rules. Legacy season selections are not
  reinterpreted as TVDB selections; unknown numbering still requires reselection.
- Treats any library/item error as a failed full sync. Successful instances may already have
  refreshed their data; retrying the scan is safe and finishes the remaining work.
- After a successful scan, invalidates `service-metadata:*` snapshots (including episode
  caches) and `tv:*:season:*` TMDB season caches. Native detail snapshots are fetched on next
  access, avoiding an additional per-title lookup over the whole library. Discovery caches
  and general TMDB details are retained.

Import-history enrichment (`availableAt` and latest-episode hints) remains **best effort**,
as before: some Sonarr installations contain unreadable history pages. Upgrade success
requires the current libraries and their season data, not a complete historical import log.
This job reads the configured services; it does not request a metadata rescan or download
inside Sonarr/Radarr.

## Retry and concurrency

- One stable key identifies each upgrade task. A completed key is never replayed on restart.
- Execution is **at least once**: a crash after side effects but before recording success can
  replay the job. Only idempotent handlers belong here.
- Failed jobs retry after 1, 2, 4… minutes, capped at one hour. The worker checks every minute.
- A database claim prevents two workers taking the same task. Its five-minute lease is
  renewed every 30 seconds; a crashed process becomes eligible again after lease expiry.
- Busy scheduler jobs remain pending. Full and incremental library syncs share an exclusion
  guard; the manual force-sync endpoint uses that same scheduler path.
- Jobs run independently of the daily cron enable switch and the initial-sync gate. The
  migration is a one-off upgrade task, not a new recurring schedule.
- Database restore stops polling and refuses to swap files while a job is executing. It
  waits for an idle queue poll to finish; maintenance also refuses late manual job triggers.

The existing Jobs screen reports the `full_sync` result; Logs contains `MigrationJob`
start/completion/retry messages. The queue retains attempts, next retry, completion and a
generic error summary, without copying upstream URLs or credentials into its error field.

## Enqueueing future work

Add a new stable task key in a **new** SQL migration, and explicitly allow its idempotent
handler in `startPostMigrationJobs` if it is not `full_sync`:

```sql
INSERT OR IGNORE INTO "PostMigrationJob" ("key", "jobKey")
SELECT 'YYYYMMDDHHMMSS_descriptive_task', 'full_sync'
WHERE EXISTS (SELECT 1 FROM "Service" WHERE "enabled" = 1 AND "type" IN ('sonarr', 'radarr'));
```

Do not reuse a completed key or enqueue on every application boot. SQLite deadlines use
epoch milliseconds to match Prisma DateTime comparisons; the table's defaults handle this.
`CURRENT_TIMESTAMP` text in `nextAttemptAt` would never satisfy Prisma's numeric due filter.

## Rollback

Normal code rollback can leave this additive table in place; the previous application simply
ignores it. Preserve its completion records for a subsequent forward deployment. If a schema
down is required, stop the app and use
`packages/backend/prisma/rollback/20261030200000_post_migration_jobs.sql`. It drops only the
work ledger. Apply the usual database backup/migration-history recovery procedure before a
future forward migration; dropping the table alone does not reset Prisma's migration history.

No complete database reset is required. The migration itself does not delete metadata or
user data; the background sync replaces season data after reading it successfully.
