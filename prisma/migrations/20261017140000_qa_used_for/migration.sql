-- What a QA form is for: a product's case stages, a manufacturing workflow's stages, or either.
ALTER TABLE "qa_templates" ADD COLUMN "usedFor" TEXT NOT NULL DEFAULT 'generic';
