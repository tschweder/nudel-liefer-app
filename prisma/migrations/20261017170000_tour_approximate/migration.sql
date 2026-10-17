-- NUD-041: remember whether the stored route is an estimate from the local heuristic
ALTER TABLE "Tour" ADD COLUMN "approximate" BOOLEAN NOT NULL DEFAULT false;
