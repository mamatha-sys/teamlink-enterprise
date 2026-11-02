// ---------------------------------------------------------------------------
// THE SALES CRM - SELF-PROVISIONING TABLES (founder 2026-11-02: "oka sales dhani kosam, crm lo em em vundalo ... take the
// actual official crm"; then "3 to 4 modules chaalu ... ahh 3 to 4 modules lo ney, motham crm cover ayyeylaaga chudu").
//
// Same pattern as calling/schema.js: raw SQL tables with no Prisma model (no `prisma generate`, no migrate), created with
// CREATE TABLE IF NOT EXISTS the first time anything needs them. ADDITIVE ONLY: nothing existing is altered. Every time
// column is TEXT (an ISO moment); a due date is YYYY-MM-DD (India date).
//
//   CrmLead      a company / person we may sell to, before it is qualified (New, Contacted, Qualified, Junk, Converted)
//   CrmAccount   a company we sell to (Prospect), or one that became a TeamLink client (Client, clientId = ATS Client.id)
//   CrmContact   a person at an account (decision maker, HR, influencer ...)
//   CrmDeal      one sales opportunity on the pipeline (stage, value, probability, expected close; Won / Lost + reason)
//   CrmActivity  a call, meeting, email, WhatsApp or note on a lead / account / deal (the timeline)
//   CrmTask      a follow-up with a due date (bell + email reminder to the owner the day it is due, once)
// ---------------------------------------------------------------------------
const prisma = require('../db');

const owner = `"ownerId" TEXT, "ownerName" TEXT, "createdById" TEXT, "createdAt" TEXT NOT NULL, "updatedAt" TEXT NOT NULL`;

const DDL = [
  `CREATE TABLE IF NOT EXISTS "CrmLead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "company" TEXT NOT NULL,
    "contactName" TEXT, "designation" TEXT, "phone" TEXT, "email" TEXT,
    "industry" TEXT, "city" TEXT, "source" TEXT,
    "status" TEXT NOT NULL DEFAULT 'New',
    "notes" TEXT,
    "accountId" TEXT, "contactId" TEXT, "dealId" TEXT, "convertedAt" TEXT,
    ${owner}
  )`,
  'CREATE INDEX IF NOT EXISTS "CrmLead_owner" ON "CrmLead"("ownerId", "status")',
  `CREATE TABLE IF NOT EXISTS "CrmAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "industry" TEXT, "city" TEXT, "website" TEXT, "phone" TEXT, "email" TEXT, "source" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'Prospect',
    "clientId" TEXT,
    "notes" TEXT,
    ${owner}
  )`,
  'CREATE INDEX IF NOT EXISTS "CrmAccount_owner" ON "CrmAccount"("ownerId")',
  `CREATE TABLE IF NOT EXISTS "CrmContact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT,
    "name" TEXT NOT NULL,
    "designation" TEXT, "role" TEXT, "phone" TEXT, "email" TEXT, "notes" TEXT,
    ${owner}
  )`,
  'CREATE INDEX IF NOT EXISTS "CrmContact_account" ON "CrmContact"("accountId")',
  `CREATE TABLE IF NOT EXISTS "CrmDeal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "accountId" TEXT, "contactId" TEXT, "leadId" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'Prospecting',
    "openings" INTEGER, "avgCtc" REAL, "feePercent" REAL, "value" REAL NOT NULL DEFAULT 0,
    "probability" INTEGER NOT NULL DEFAULT 10,
    "expectedClose" TEXT,
    "lostReason" TEXT, "wonAt" TEXT, "lostAt" TEXT,
    "clientId" TEXT,
    "notes" TEXT,
    ${owner}
  )`,
  'CREATE INDEX IF NOT EXISTS "CrmDeal_owner" ON "CrmDeal"("ownerId", "stage")',
  'CREATE INDEX IF NOT EXISTS "CrmDeal_account" ON "CrmDeal"("accountId")',
  `CREATE TABLE IF NOT EXISTS "CrmActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "subject" TEXT, "note" TEXT,
    "at" TEXT NOT NULL,
    "leadId" TEXT, "accountId" TEXT, "dealId" TEXT, "contactId" TEXT,
    "byId" TEXT, "byName" TEXT,
    "createdAt" TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS "CrmActivity_lead" ON "CrmActivity"("leadId")',
  'CREATE INDEX IF NOT EXISTS "CrmActivity_account" ON "CrmActivity"("accountId")',
  'CREATE INDEX IF NOT EXISTS "CrmActivity_deal" ON "CrmActivity"("dealId")',
  `CREATE TABLE IF NOT EXISTS "CrmTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL, "dueTime" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "leadId" TEXT, "accountId" TEXT, "dealId" TEXT,
    "doneAt" TEXT, "doneNote" TEXT, "remindedOn" TEXT,
    ${owner}
  )`,
  'CREATE INDEX IF NOT EXISTS "CrmTask_owner" ON "CrmTask"("ownerId", "status", "dueDate")',
];

let done = null;
function ensure() {
  if (done) return done;
  done = (async () => {
    for (const sql of DDL) await prisma.$executeRawUnsafe(sql); // eslint-disable-line no-await-in-loop
    return true;
  })().catch((err) => { done = null; console.error('[crm] schema:', err.message); return false; }); // eslint-disable-line no-console
  return done;
}

const nowIso = () => new Date().toISOString();
const plain = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]));
async function all(sql, ...params) { await ensure(); return (await prisma.$queryRawUnsafe(sql, ...params)).map(plain); }
async function one(sql, ...params) { const r = await all(sql, ...params); return r[0] || null; }
async function run(sql, ...params) { await ensure(); return prisma.$executeRawUnsafe(sql, ...params); }

module.exports = { DDL, ensure, nowIso, all, one, run };
