-- NUD-082: when the office last changed a stop (re-release), for the offline sync conflict rule
ALTER TABLE "Stop" ADD COLUMN "adminChangedAt" TIMESTAMP(3);
