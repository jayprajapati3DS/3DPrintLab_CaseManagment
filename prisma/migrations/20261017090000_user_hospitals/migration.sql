-- The hospitals a person works at, for case forms that list a surgeon's hospitals.
ALTER TABLE "users" ADD COLUMN "hospitalIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
