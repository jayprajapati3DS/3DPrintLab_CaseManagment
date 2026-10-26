-- A sort key for case numbers, so they order the way people read them.
ALTER TABLE "case_records" ADD COLUMN "caseNumberSort" TEXT;

-- Back-fill, with the same rule as src/lib/cases/sort-key.ts: lower-case, and
-- every run of digits padded to 12. The first pass puts twelve zeros in front
-- of each run; the second keeps the last twelve digits of it.
UPDATE "case_records"
SET "caseNumberSort" = regexp_replace(
  regexp_replace(lower(btrim("caseNumber")), '(\d+)', '000000000000\1', 'g'),
  '\d*(\d{12})', '\1', 'g'
)
WHERE "caseNumber" IS NOT NULL AND btrim("caseNumber") <> '';

CREATE INDEX "case_records_spaceId_caseNumberSort_idx" ON "case_records"("spaceId", "caseNumberSort");
