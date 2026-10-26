-- A person's signature image, kept on My account and copied onto a form when they sign it.
ALTER TABLE "users" ADD COLUMN "signatureKey" TEXT;
ALTER TABLE "users" ADD COLUMN "signatureType" TEXT;
ALTER TABLE "users" ADD COLUMN "signatureUpdatedAt" TIMESTAMP(3);
