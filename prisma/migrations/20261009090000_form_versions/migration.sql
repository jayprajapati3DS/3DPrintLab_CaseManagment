-- QA form versions: the record as it stood when approved or rejected, kept for comparison.
ALTER TABLE "part_forms" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "part_form_versions" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "event" TEXT NOT NULL,
    "reason" TEXT,
    "byId" TEXT,
    "byName" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "values" JSONB NOT NULL,
    "measured" JSONB NOT NULL,
    "quantities" JSONB NOT NULL,
    "snap" JSONB NOT NULL,
    "outOfSpec" INTEGER NOT NULL DEFAULT 0,
    "submittedByName" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "part_form_versions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "part_form_versions_formId_createdAt_idx" ON "part_form_versions"("formId", "createdAt");

ALTER TABLE "part_form_versions" ADD CONSTRAINT "part_form_versions_formId_fkey" FOREIGN KEY ("formId") REFERENCES "part_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
