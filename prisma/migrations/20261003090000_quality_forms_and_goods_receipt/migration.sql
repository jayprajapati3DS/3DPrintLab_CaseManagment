-- AlterTable
ALTER TABLE "material_lots" ADD COLUMN     "grnId" TEXT,
ADD COLUMN     "grnNumber" TEXT,
ADD COLUMN     "rejected" DECIMAL(12,3);

-- AlterTable
ALTER TABLE "parts" ADD COLUMN     "formsReadyAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "space_settings" (
    "spaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByName" TEXT,

    CONSTRAINT "space_settings_pkey" PRIMARY KEY ("spaceId","key")
);

-- CreateTable
CREATE TABLE "qa_templates" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "clause" TEXT NOT NULL DEFAULT '',
    "issue" TEXT NOT NULL DEFAULT '',
    "effective" TEXT NOT NULL DEFAULT '',
    "rev" TEXT NOT NULL DEFAULT '',
    "docLayout" BOOLEAN NOT NULL DEFAULT false,
    "attach" TEXT[],
    "sections" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByName" TEXT,

    CONSTRAINT "qa_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_forms" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "templateId" TEXT,
    "stageIndex" INTEGER NOT NULL,
    "stageName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "clause" TEXT NOT NULL,
    "issue" TEXT NOT NULL,
    "effective" TEXT NOT NULL,
    "rev" TEXT NOT NULL,
    "docLayout" BOOLEAN NOT NULL,
    "sections" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Upcoming',
    "assigneeId" TEXT,
    "assigneeName" TEXT,
    "values" JSONB NOT NULL,
    "measured" JSONB NOT NULL,
    "quantities" JSONB NOT NULL,
    "snap" JSONB NOT NULL,
    "outOfSpec" INTEGER NOT NULL DEFAULT 0,
    "savedById" TEXT,
    "savedByName" TEXT,
    "savedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "submittedByName" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "part_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_uses" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "itemId" TEXT,
    "label" TEXT NOT NULL,
    "quantity" DECIMAL(12,3),
    "unit" TEXT,
    "field" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_uses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grns" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "receivedOn" DATE NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT,
    "header" JSONB NOT NULL,
    "received" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMP(3),
    "confirmedByName" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grn_lines" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "grnId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "itemId" TEXT,
    "itemName" TEXT,
    "lotMode" TEXT NOT NULL DEFAULT 'new',
    "lotNumber" TEXT,
    "existingLotId" TEXT,
    "supplierBatch" TEXT,
    "quantity" DECIMAL(12,3),
    "unit" TEXT,
    "expiresOn" DATE,
    "coa" TEXT,
    "partIds" TEXT[],
    "ref" TEXT,
    "calItemId" TEXT,
    "cert" TEXT,
    "calDate" DATE,
    "category" TEXT,
    "equipmentMode" TEXT,
    "newName" TEXT,
    "newAsset" TEXT,
    "description" TEXT,
    "extra" JSONB NOT NULL,
    "tests" JSONB NOT NULL,
    "rejectedQty" DECIMAL(12,3),
    "decision" TEXT,
    "reason" TEXT,
    "inspectedById" TEXT,
    "inspectedByName" TEXT,
    "inspectedAt" TIMESTAMP(3),
    "testSummary" TEXT,
    "resultId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grn_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grn_documents" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "grnId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grn_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grn_log" (
    "id" TEXT NOT NULL,
    "grnId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grn_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "qa_templates_spaceId_idx" ON "qa_templates"("spaceId");

-- CreateIndex
CREATE INDEX "part_forms_partId_idx" ON "part_forms"("partId");

-- CreateIndex
CREATE INDEX "part_forms_spaceId_status_idx" ON "part_forms"("spaceId", "status");

-- CreateIndex
CREATE INDEX "form_uses_spaceId_source_itemId_idx" ON "form_uses"("spaceId", "source", "itemId");

-- CreateIndex
CREATE INDEX "form_uses_formId_idx" ON "form_uses"("formId");

-- CreateIndex
CREATE INDEX "grns_spaceId_received_idx" ON "grns"("spaceId", "received");

-- CreateIndex
CREATE UNIQUE INDEX "grns_spaceId_number_key" ON "grns"("spaceId", "number");

-- CreateIndex
CREATE INDEX "grn_lines_grnId_idx" ON "grn_lines"("grnId");

-- CreateIndex
CREATE INDEX "grn_lines_spaceId_type_idx" ON "grn_lines"("spaceId", "type");

-- CreateIndex
CREATE INDEX "grn_documents_grnId_idx" ON "grn_documents"("grnId");

-- CreateIndex
CREATE INDEX "grn_log_grnId_createdAt_idx" ON "grn_log"("grnId", "createdAt");

-- AddForeignKey
ALTER TABLE "part_forms" ADD CONSTRAINT "part_forms_partId_fkey" FOREIGN KEY ("partId") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_forms" ADD CONSTRAINT "part_forms_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "qa_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_uses" ADD CONSTRAINT "form_uses_formId_fkey" FOREIGN KEY ("formId") REFERENCES "part_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "grns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_documents" ADD CONSTRAINT "grn_documents_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "grns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_log" ADD CONSTRAINT "grn_log_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "grns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

