-- The Order tab: forms between the surgeon and the internal team, not tied to a case status.
ALTER TABLE "part_forms" ADD COLUMN "area" TEXT NOT NULL DEFAULT 'stage';
ALTER TABLE "part_forms" ADD COLUMN "withdrawnAt" TIMESTAMP(3);
ALTER TABLE "part_forms" ADD COLUMN "withdrawnByName" TEXT;
ALTER TABLE "part_forms" ADD COLUMN "withdrawnReason" TEXT;
ALTER TABLE "case_records" ADD COLUMN "ordersReadyAt" TIMESTAMP(3);
-- Surgeons signing in to see only their cases' Order tab.
ALTER TABLE "users" ADD COLUMN "surgeonOnly" BOOLEAN NOT NULL DEFAULT false;
