-- CreateTable
CREATE TABLE "technologies" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "technologies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_types" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "part_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT '',
    "data" JSONB NOT NULL,
    "imageId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "archivedById" TEXT,
    "archivedByName" TEXT,
    "archiveReason" TEXT,
    "deletionRequestedAt" TIMESTAMP(3),
    "deletionRequestedById" TEXT,
    "deletionRequestedByName" TEXT,
    "deletionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_items" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "track" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dueOn" DATE,
    "repeatMonths" INTEGER,
    "lastDoneOn" DATE,
    "lastResult" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_records" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "itemId" TEXT,
    "track" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "doneOn" DATE NOT NULL,
    "doneBy" TEXT NOT NULL,
    "result" TEXT,
    "ref" TEXT,
    "note" TEXT,
    "affectsValidation" BOOLEAN NOT NULL DEFAULT false,
    "reviewOutcome" TEXT,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "recordedById" TEXT,
    "recordedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_documents" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "recordId" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" TEXT,
    "uploadedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_lots" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "supplierLot" TEXT,
    "remaining" DECIMAL(12,3) NOT NULL,
    "received" DECIMAL(12,3) NOT NULL,
    "receivedOn" DATE,
    "supplier" TEXT,
    "coa" TEXT,
    "expiresOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot_adjustments" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "byId" TEXT,
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lot_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "technologies_spaceId_name_key" ON "technologies"("spaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "part_types_spaceId_name_key" ON "part_types"("spaceId", "name");

-- CreateIndex
CREATE INDEX "resources_spaceId_kind_archivedAt_idx" ON "resources"("spaceId", "kind", "archivedAt");

-- CreateIndex
CREATE INDEX "schedule_items_resourceId_track_idx" ON "schedule_items"("resourceId", "track");

-- CreateIndex
CREATE INDEX "schedule_records_resourceId_track_doneOn_idx" ON "schedule_records"("resourceId", "track", "doneOn");

-- CreateIndex
CREATE INDEX "resource_documents_resourceId_idx" ON "resource_documents"("resourceId");

-- CreateIndex
CREATE INDEX "material_lots_resourceId_idx" ON "material_lots"("resourceId");

-- AddForeignKey
ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_records" ADD CONSTRAINT "schedule_records_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_records" ADD CONSTRAINT "schedule_records_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "schedule_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_documents" ADD CONSTRAINT "resource_documents_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_documents" ADD CONSTRAINT "resource_documents_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "schedule_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_adjustments" ADD CONSTRAINT "lot_adjustments_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "material_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

