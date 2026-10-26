-- One stock ledger: components and packaging keep their stock in lots, as
-- materials do, and a lot points at the supplier record it came from.

ALTER TABLE "material_lots" ADD COLUMN "supplierId" TEXT;

-- Stock typed on a component or packaging item becomes an opening-stock lot,
-- so nothing on hand is lost when those fields stop being editable.
INSERT INTO "material_lots" ("id", "resourceId", "lotNumber", "remaining", "received", "receivedOn", "supplier", "expiresOn", "createdAt")
SELECT
  'mig' || substr(md5(r."id"), 1, 22),
  r."id",
  COALESCE(NULLIF(btrim(r."data"->>'lot'), ''), 'OPENING'),
  CASE WHEN r."data"->>'stock' ~ '^[0-9]+(\.[0-9]+)?$' THEN (r."data"->>'stock')::numeric ELSE 0 END,
  CASE WHEN r."data"->>'stock' ~ '^[0-9]+(\.[0-9]+)?$' THEN (r."data"->>'stock')::numeric ELSE 0 END,
  r."createdAt"::date,
  NULLIF(btrim(r."data"->>'supplier'), ''),
  CASE WHEN r."data"->>'expiry' ~ '^\d{4}-\d{2}-\d{2}$' THEN (r."data"->>'expiry')::date END,
  CURRENT_TIMESTAMP
FROM "resources" r
WHERE r."kind" IN ('components', 'packaging')
  AND (COALESCE(btrim(r."data"->>'stock'), '') <> '' OR COALESCE(btrim(r."data"->>'lot'), '') <> '');

UPDATE "resources"
SET "data" = "data" - 'stock' - 'lot' - 'expiry' - 'supplier'
WHERE "kind" IN ('components', 'packaging');

-- Link existing lots to their supplier by name, within the same space.
UPDATE "material_lots" l
SET "supplierId" = v."id"
FROM "resources" r, "resources" v
WHERE r."id" = l."resourceId"
  AND v."spaceId" = r."spaceId"
  AND v."kind" = 'vendors'
  AND l."supplierId" IS NULL
  AND l."supplier" IS NOT NULL
  AND lower(btrim(v."name")) = lower(btrim(l."supplier"));

CREATE INDEX "material_lots_supplierId_idx" ON "material_lots"("supplierId");
