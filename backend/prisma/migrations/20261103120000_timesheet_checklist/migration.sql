-- Timesheet > Checklist (founder 2026-11-03): each person writes what they did today - from/to time, status, description.
CREATE TABLE "TimesheetChecklist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "employeeId" TEXT,
    "date" TEXT NOT NULL,
    "fromTime" TEXT NOT NULL,
    "toTime" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "description" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "TimesheetChecklist_userId_date_idx" ON "TimesheetChecklist"("userId", "date");
CREATE INDEX "TimesheetChecklist_date_idx" ON "TimesheetChecklist"("date");
