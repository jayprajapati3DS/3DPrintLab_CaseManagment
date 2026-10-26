-- A quality form is sent to one chosen person for approval.
ALTER TABLE "part_forms" ADD COLUMN "sentToId" TEXT;
ALTER TABLE "part_forms" ADD COLUMN "sentToName" TEXT;
CREATE INDEX "part_forms_sentToId_status_idx" ON "part_forms"("sentToId", "status");
