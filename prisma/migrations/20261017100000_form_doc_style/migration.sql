-- A controlled form's validity date and header style, on templates and the forms copied from them.
ALTER TABLE "qa_templates" ADD COLUMN "validity" TEXT NOT NULL DEFAULT '', ADD COLUMN "docStyle" TEXT NOT NULL DEFAULT 'reference';
ALTER TABLE "part_forms" ADD COLUMN "validity" TEXT NOT NULL DEFAULT '', ADD COLUMN "docStyle" TEXT NOT NULL DEFAULT 'reference';
