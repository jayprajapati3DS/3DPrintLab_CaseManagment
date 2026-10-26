-- How large a request image is shown: S, M, L or XL; null = M.
ALTER TABLE "part_files" ADD COLUMN "displaySize" TEXT;
