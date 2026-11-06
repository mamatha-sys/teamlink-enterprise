-- Personal email and company email (2026-11-06): the personal address stays for good, the company address is the login
ALTER TABLE "Employee" ADD COLUMN "personalEmail" TEXT;
ALTER TABLE "Employee" ADD COLUMN "companyEmail" TEXT;
ALTER TABLE "Employee" ADD COLUMN "companyEmailAt" DATETIME;
ALTER TABLE "Employee" ADD COLUMN "companyEmailBy" TEXT;
CREATE INDEX "Employee_personalEmail_idx" ON "Employee"("personalEmail");
