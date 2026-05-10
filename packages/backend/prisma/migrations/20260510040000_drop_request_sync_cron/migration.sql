-- Drop the legacy `request_sync` cron row left over from the *arr tag-based request sync
-- (removed in 0.9.x — see GitHub issue #192 for the replacement Seerr import flow).
DELETE FROM "CronJob" WHERE "key" = 'request_sync';
