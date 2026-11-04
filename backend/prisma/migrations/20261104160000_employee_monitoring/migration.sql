-- Employee Monitoring (2026-11-04): office PCs, consent, activity, app categories, settings (routes/monitoring.js)
-- CreateTable
CREATE TABLE "monitoring_devices" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employee_id" TEXT NOT NULL,
    "device_name" TEXT NOT NULL,
    "os" TEXT,
    "device_token" TEXT NOT NULL,
    "registered_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" DATETIME,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "monitoring_devices_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "monitoring_consents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employee_id" TEXT NOT NULL,
    "policy_version" INTEGER NOT NULL,
    "accepted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "via" TEXT,
    CONSTRAINT "monitoring_consents_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "device_id" TEXT,
    "employee_id" TEXT NOT NULL,
    "app_name" TEXT NOT NULL,
    "window_title" TEXT,
    "start_time" DATETIME NOT NULL,
    "end_time" DATETIME NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "is_idle" BOOLEAN NOT NULL DEFAULT false,
    "day" TEXT NOT NULL,
    CONSTRAINT "activity_logs_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "monitoring_devices" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "activity_logs_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "app_categories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "app_name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'app',
    "category" TEXT NOT NULL,
    "set_by" TEXT,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "monitoring_settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "work_start" TEXT NOT NULL DEFAULT '09:30',
    "work_end" TEXT NOT NULL DEFAULT '18:30',
    "idle_threshold_minutes" INTEGER NOT NULL DEFAULT 5,
    "retention_days" INTEGER NOT NULL DEFAULT 90,
    "screenshots_enabled" BOOLEAN NOT NULL DEFAULT false,
    "policy_version" INTEGER NOT NULL DEFAULT 1,
    "policy_text" TEXT,
    "updated_by" TEXT,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "monitoring_devices_device_token_key" ON "monitoring_devices"("device_token");

-- CreateIndex
CREATE INDEX "monitoring_devices_employee_id_idx" ON "monitoring_devices"("employee_id");

-- CreateIndex
CREATE INDEX "monitoring_consents_employee_id_policy_version_idx" ON "monitoring_consents"("employee_id", "policy_version");

-- CreateIndex
CREATE INDEX "activity_logs_employee_id_day_idx" ON "activity_logs"("employee_id", "day");

-- CreateIndex
CREATE INDEX "activity_logs_day_idx" ON "activity_logs"("day");

-- CreateIndex
CREATE INDEX "activity_logs_start_time_idx" ON "activity_logs"("start_time");

-- CreateIndex
CREATE UNIQUE INDEX "app_categories_app_name_key" ON "app_categories"("app_name");

