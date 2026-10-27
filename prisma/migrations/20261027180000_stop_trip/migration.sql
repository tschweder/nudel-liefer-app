-- Reload trips (NUD-147, D24). A stop belongs to a trip of its tour (1 = first trip); between two
-- trips the vehicle returns to the depot to reload. Additive: every existing stop is trip 1.
-- AlterTable
ALTER TABLE "Stop" ADD COLUMN "trip" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Stop" ADD CONSTRAINT "Stop_trip_positive" CHECK ("trip" >= 1);
