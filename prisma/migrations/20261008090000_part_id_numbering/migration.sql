-- How part IDs are numbered: per case (as before), per case and part type, or across the space; and how many digits.
ALTER TABLE "part_request_setups" ADD COLUMN "idScope" TEXT NOT NULL DEFAULT 'case';
ALTER TABLE "part_request_setups" ADD COLUMN "idWidth" INTEGER NOT NULL DEFAULT 2;
