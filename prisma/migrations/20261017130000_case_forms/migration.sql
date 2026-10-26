-- Quality forms on a case's stages: a form (and its signature / evidence files,
-- and what it used) belongs to a part or to a case.
ALTER TABLE "part_forms" ALTER COLUMN "partId" DROP NOT NULL, ADD COLUMN "caseId" TEXT;
ALTER TABLE "part_forms" ADD CONSTRAINT "part_forms_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "case_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "part_forms_caseId_idx" ON "part_forms"("caseId");

ALTER TABLE "part_files" ALTER COLUMN "partId" DROP NOT NULL, ADD COLUMN "caseId" TEXT;
ALTER TABLE "part_files" ADD CONSTRAINT "part_files_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "case_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "form_uses" ALTER COLUMN "partId" DROP NOT NULL;

ALTER TABLE "case_records" ADD COLUMN "formsReadyAt" TIMESTAMP(3);
