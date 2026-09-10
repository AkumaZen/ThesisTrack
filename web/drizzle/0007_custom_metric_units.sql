ALTER TABLE "metric_definitions" ALTER COLUMN "unit" SET DATA TYPE varchar(40);--> statement-breakpoint
DROP TYPE "public"."metric_unit";