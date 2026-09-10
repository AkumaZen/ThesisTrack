ALTER TABLE "guidance_notes" ADD COLUMN "target_metric" varchar(20);--> statement-breakpoint
ALTER TABLE "guidance_notes" ADD COLUMN "target_metric_label" varchar(60);--> statement-breakpoint
ALTER TABLE "guidance_notes" ADD COLUMN "target_value" numeric;--> statement-breakpoint
ALTER TABLE "guidance_notes" ADD COLUMN "target_unit" varchar(20);--> statement-breakpoint
ALTER TABLE "guidance_notes" ADD COLUMN "target_period" varchar(20);--> statement-breakpoint
ALTER TABLE "guidance_notes" ADD COLUMN "outcome" varchar(10) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "guidance_notes" ADD CONSTRAINT "outcome_check" CHECK ("guidance_notes"."outcome" IN ('pending', 'achieved', 'missed'));--> statement-breakpoint
ALTER TABLE "guidance_notes" ADD CONSTRAINT "target_metric_check" CHECK ("guidance_notes"."target_metric" IS NULL OR "guidance_notes"."target_metric" IN ('revenue', 'margin', 'other'));