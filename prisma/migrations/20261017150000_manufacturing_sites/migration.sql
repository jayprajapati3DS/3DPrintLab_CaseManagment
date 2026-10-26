-- Manufacturing sites: where a part is made (in-house, a partner hospital, a vendor), and who works at each.
ALTER TABLE "users" ADD COLUMN "siteIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "users" ADD COLUMN "siteOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "parts" ADD COLUMN "siteId" TEXT;
ALTER TABLE "parts" ADD COLUMN "siteName" TEXT;
