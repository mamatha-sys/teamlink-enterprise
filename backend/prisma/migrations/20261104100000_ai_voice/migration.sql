-- AI Voice campaigns (Omni-Channel > Campaigns > AI Voice, 2026-11-04). Additive only; the same statements calling/schema.js creates by itself.
-- Rollback: DROP TABLE "AiVoiceCampaign"; DROP TABLE "AiVoiceAgent"; DROP INDEX "AiCall_campaign";

CREATE TABLE IF NOT EXISTS "AiVoiceAgent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "language" TEXT,
    "instructions" TEXT,
    "includeSalary" INTEGER NOT NULL DEFAULT 0,
    "includeResponsibilities" INTEGER NOT NULL DEFAULT 0,
    "active" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
  );

CREATE TABLE IF NOT EXISTS "AiVoiceCampaign" (
    "campaignId" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'running',
    "agentId" TEXT,
    "agentName" TEXT,
    "language" TEXT,
    "concurrency" INTEGER NOT NULL DEFAULT 2,
    "scheduledAt" TEXT,
    "startedAt" TEXT,
    "endedAt" TEXT,
    "note" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
  );

CREATE INDEX IF NOT EXISTS "AiVoiceCampaign_status" ON "AiVoiceCampaign"("status");
CREATE INDEX IF NOT EXISTS "AiCall_campaign" ON "AiCall"("campaignId", "status");
