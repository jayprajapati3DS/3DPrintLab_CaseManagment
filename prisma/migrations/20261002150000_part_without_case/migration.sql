-- A part no longer has to belong to a case.
ALTER TABLE "parts" ALTER COLUMN "caseId" DROP NOT NULL;
