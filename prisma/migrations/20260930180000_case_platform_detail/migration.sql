-- The platform's case edit page, read on demand and cached per case.
ALTER TABLE "case_records" ADD COLUMN "platformEditPath" TEXT;
ALTER TABLE "case_records" ADD COLUMN "detailEncrypted" TEXT;
ALTER TABLE "case_records" ADD COLUMN "detailFetchedAt" TIMESTAMP(3);
