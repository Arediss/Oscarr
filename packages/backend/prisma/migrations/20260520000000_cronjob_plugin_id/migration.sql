-- AlterTable: track which plugin owns a CronJob row. NULL = core/system job.
ALTER TABLE "CronJob" ADD COLUMN "pluginId" TEXT;
CREATE INDEX "CronJob_pluginId_idx" ON "CronJob"("pluginId");
