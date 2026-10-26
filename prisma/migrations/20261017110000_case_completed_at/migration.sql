-- When a case was marked completed: its end date.
ALTER TABLE "case_records" ADD COLUMN "completedAt" TIMESTAMP(3);
