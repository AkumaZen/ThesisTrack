CREATE TABLE "operating_models" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "operating_models_name_unique" UNIQUE("name")
);
--> statement-breakpoint
INSERT INTO "operating_models" ("name") VALUES ('factory'), ('subscription'), ('money_lending'), ('retail_stores'), ('services') ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "companies" ALTER COLUMN "operating_model" SET DATA TYPE varchar(50) USING "operating_model"::text;--> statement-breakpoint
ALTER TABLE "metric_definitions" ALTER COLUMN "operating_model" SET DATA TYPE varchar(50) USING "operating_model"::text;--> statement-breakpoint
ALTER TABLE "sectors" ALTER COLUMN "operating_model" SET DATA TYPE varchar(50) USING "operating_model"::text;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_operating_model_operating_models_name_fk" FOREIGN KEY ("operating_model") REFERENCES "public"."operating_models"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_definitions" ADD CONSTRAINT "metric_definitions_operating_model_operating_models_name_fk" FOREIGN KEY ("operating_model") REFERENCES "public"."operating_models"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sectors" ADD CONSTRAINT "sectors_operating_model_operating_models_name_fk" FOREIGN KEY ("operating_model") REFERENCES "public"."operating_models"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
DROP TYPE "public"."operating_model";