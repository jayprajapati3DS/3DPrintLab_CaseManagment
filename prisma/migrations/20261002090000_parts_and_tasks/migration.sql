-- CreateTable
CREATE TABLE "part_request_setups" (
    "spaceId" TEXT NOT NULL,
    "idPrefix" TEXT NOT NULL DEFAULT 'JM',
    "idSeparator" TEXT NOT NULL DEFAULT '-',
    "idTokens" TEXT[],
    "sections" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByName" TEXT,

    CONSTRAINT "part_request_setups_pkey" PRIMARY KEY ("spaceId")
);

-- CreateTable
CREATE TABLE "parts" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "partNumber" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "dueOn" DATE,
    "partType" TEXT,
    "priority" TEXT,
    "notes" TEXT,
    "workflowId" TEXT,
    "workflowName" TEXT NOT NULL,
    "stages" JSONB NOT NULL,
    "stageCount" INTEGER NOT NULL,
    "stageIndex" INTEGER NOT NULL DEFAULT 0,
    "stageMeta" JSONB NOT NULL,
    "technology" TEXT,
    "material" TEXT,
    "printer" TEXT,
    "sourcing" TEXT NOT NULL DEFAULT 'In-house',
    "vendor" TEXT,
    "assigneeId" TEXT,
    "assigneeName" TEXT,
    "details" JSONB NOT NULL,
    "inspection" JSONB,
    "links" TEXT[],
    "requestedById" TEXT,
    "requestedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_files" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "field" TEXT,
    "name" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "part_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_activity" (
    "id" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "byId" TEXT,
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "part_activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'Manual',
    "caseId" TEXT,
    "partId" TEXT,
    "stageIndex" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "assigneeId" TEXT,
    "assigneeName" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'Medium',
    "dueOn" DATE,
    "reminders" INTEGER[],
    "tags" TEXT[],
    "checklist" JSONB NOT NULL,
    "completedByName" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parts_spaceId_stageIndex_idx" ON "parts"("spaceId", "stageIndex");

-- CreateIndex
CREATE INDEX "parts_caseId_idx" ON "parts"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "parts_spaceId_partNumber_key" ON "parts"("spaceId", "partNumber");

-- CreateIndex
CREATE INDEX "part_files_partId_idx" ON "part_files"("partId");

-- CreateIndex
CREATE INDEX "part_activity_partId_createdAt_idx" ON "part_activity"("partId", "createdAt");

-- CreateIndex
CREATE INDEX "tasks_spaceId_type_status_idx" ON "tasks"("spaceId", "type", "status");

-- CreateIndex
CREATE INDEX "tasks_partId_idx" ON "tasks"("partId");

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "case_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_files" ADD CONSTRAINT "part_files_partId_fkey" FOREIGN KEY ("partId") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_activity" ADD CONSTRAINT "part_activity_partId_fkey" FOREIGN KEY ("partId") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "case_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_partId_fkey" FOREIGN KEY ("partId") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

