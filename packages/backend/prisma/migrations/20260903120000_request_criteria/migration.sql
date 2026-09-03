-- Admin-defined axes describing how a title is wanted (language, edition, source…), and the
-- values a request picked. Written by hand rather than generated: `prisma migrate diff` also
-- emits a DROP INDEX and two table rebuilds that come from pre-existing drift between the
-- migration history and the schema, none of which belongs in this change.

-- CreateTable
CREATE TABLE "RequestCriterion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "showOnRequest" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "RequestCriterion_name_key" ON "RequestCriterion"("name");

-- CreateTable
CREATE TABLE "RequestCriterionValue" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "criterionId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RequestCriterionValue_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "RequestCriterion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "RequestCriterionValue_criterionId_label_key" ON "RequestCriterionValue"("criterionId", "label");

-- CreateTable
CREATE TABLE "MediaRequestCriterion" (
    "requestId" INTEGER NOT NULL,
    "valueId" INTEGER NOT NULL,

    PRIMARY KEY ("requestId", "valueId"),
    CONSTRAINT "MediaRequestCriterion_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MediaRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MediaRequestCriterion_valueId_fkey" FOREIGN KEY ("valueId") REFERENCES "RequestCriterionValue" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MediaRequestCriterion_valueId_idx" ON "MediaRequestCriterion"("valueId");
