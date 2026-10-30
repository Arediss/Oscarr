-- Stop the application first. Code rollback normally keeps this additive table untouched.
-- This schema down path removes only the work ledger, never library or user data.
DROP TABLE "PostMigrationJob";
