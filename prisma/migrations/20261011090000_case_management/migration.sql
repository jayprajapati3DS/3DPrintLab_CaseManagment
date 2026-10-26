-- Case management: cases created in the app (no platform sync), their answers and files.
ALTER TABLE "case_records" ALTER COLUMN "platformCaseId" DROP NOT NULL;
ALTER TABLE "case_records" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'platform';
ALTER TABLE "case_records" ADD COLUMN "productId" TEXT;
ALTER TABLE "case_records" ADD COLUMN "subscopeId" TEXT;
ALTER TABLE "case_records" ADD COLUMN "patientIdEncrypted" TEXT;
ALTER TABLE "case_records" ADD COLUMN "details" JSONB;
ALTER TABLE "case_records" ADD COLUMN "createdByName" TEXT;

CREATE TABLE "case_files" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "field" TEXT,
    "name" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "case_files_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "case_files_caseId_idx" ON "case_files"("caseId");
ALTER TABLE "case_files" ADD CONSTRAINT "case_files_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "case_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
