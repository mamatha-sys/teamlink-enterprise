-- Employee Monitoring (2026-11-05): the daily lunch break: that time counts as Break, not idle, and keeps no app details
ALTER TABLE "monitoring_settings" ADD COLUMN "break_start" TEXT NOT NULL DEFAULT '12:30';
ALTER TABLE "monitoring_settings" ADD COLUMN "break_end" TEXT NOT NULL DEFAULT '13:15';
