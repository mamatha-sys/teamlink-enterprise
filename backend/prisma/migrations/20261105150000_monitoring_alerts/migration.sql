-- Employee Monitoring (2026-11-05): alerts: long idle, agent stopped, no signal, low activity (off until HR switches them on)
ALTER TABLE "monitoring_settings" ADD COLUMN "alerts_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "monitoring_settings" ADD COLUMN "long_idle_minutes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "monitoring_settings" ADD COLUMN "offline_minutes" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "monitoring_settings" ADD COLUMN "low_activity_hours" INTEGER NOT NULL DEFAULT 4;
CREATE TABLE "monitoring_alerts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employee_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "detail" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "monitoring_alerts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "monitoring_alerts_employee_id_kind_day_key" ON "monitoring_alerts"("employee_id", "kind", "day");
CREATE INDEX "monitoring_alerts_day_idx" ON "monitoring_alerts"("day");
