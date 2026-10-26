-- A space can keep several part request forms; each part remembers its own.
CREATE TABLE "part_request_forms" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "sections" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByName" TEXT,
    CONSTRAINT "part_request_forms_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "part_request_forms_spaceId_idx" ON "part_request_forms"("spaceId");

ALTER TABLE "parts" ADD COLUMN "requestFormId" TEXT;
ALTER TABLE "parts" ADD COLUMN "requestFormName" TEXT;

-- The form each space has saved becomes its first form, "Standard"; its id is
-- the one a space uses before anything is saved (std-<space id>).
INSERT INTO "part_request_forms" ("id", "spaceId", "name", "sections", "isDefault", "position", "updatedAt", "updatedByName")
SELECT 'std-' || "spaceId", "spaceId", 'Standard', "sections", true, 0, "updatedAt", "updatedByName"
FROM "part_request_setups";

-- Every part so far was requested with that form.
UPDATE "parts" SET "requestFormId" = 'std-' || "spaceId", "requestFormName" = 'Standard';
