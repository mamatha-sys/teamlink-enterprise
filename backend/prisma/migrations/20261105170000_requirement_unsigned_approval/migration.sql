-- A requirement opens on an unsigned agreement with the BDE TL's approval (founder 2026-11-05, utils/unsignedOpen.js)
ALTER TABLE "Requirement" ADD COLUMN "unsignedApprovedAt" DATETIME;
ALTER TABLE "Requirement" ADD COLUMN "unsignedApprovedBy" TEXT;
CREATE TABLE "RequirementOpenRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requirementId" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "askedById" TEXT NOT NULL,
    "askedByName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decidedAt" DATETIME,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RequirementOpenRequest_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "RequirementOpenRequest_status_idx" ON "RequirementOpenRequest"("status");
CREATE INDEX "RequirementOpenRequest_requirementId_idx" ON "RequirementOpenRequest"("requirementId");
CREATE UNIQUE INDEX "RequirementOpenRequest_one_waiting" ON "RequirementOpenRequest"("requirementId") WHERE "status" = 'PENDING';
