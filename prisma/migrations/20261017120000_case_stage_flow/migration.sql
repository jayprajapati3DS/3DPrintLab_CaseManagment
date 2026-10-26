-- Cases opened here move through their stages: owner, current stage, per-stage history.
ALTER TABLE "case_records" ADD COLUMN "assigneeId" TEXT, ADD COLUMN "assigneeName" TEXT, ADD COLUMN "stageIndex" INTEGER, ADD COLUMN "stageMeta" JSONB;
