-- Employee Monitoring (2026-11-05): the rest of the founder's plan: overrides, night shift, exclusions, IT Admin, device approval, auto-update, scheduled mail
ALTER TABLE "monitoring_settings" ADD COLUMN "unauthorized_apps" TEXT;
ALTER TABLE "monitoring_settings" ADD COLUMN "alert_email" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "monitoring_settings" ADD COLUMN "track_titles" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "monitoring_settings" ADD COLUMN "report_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "monitoring_settings" ADD COLUMN "report_frequency" TEXT NOT NULL DEFAULT 'daily';
ALTER TABLE "monitoring_settings" ADD COLUMN "report_emails" TEXT;
ALTER TABLE "monitoring_settings" ADD COLUMN "report_last_day" TEXT;
ALTER TABLE "monitoring_settings" ADD COLUMN "auto_update" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "monitoring_settings" ADD COLUMN "device_approval" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "monitoring_settings" ADD COLUMN "it_admin_ids" TEXT;
ALTER TABLE "monitoring_devices" ADD COLUMN "approved" BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE "monitoring_overrides" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "work_start" TEXT,
    "work_end" TEXT,
    "break_start" TEXT,
    "break_end" TEXT,
    "idle_threshold_minutes" INTEGER,
    "track_titles" BOOLEAN,
    "excluded" BOOLEAN,
    "updated_by" TEXT,
    "updated_at" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "monitoring_overrides_scope_target_key" ON "monitoring_overrides"("scope", "target");
