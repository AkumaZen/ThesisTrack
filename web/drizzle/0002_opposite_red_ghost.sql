CREATE TABLE "custom_notes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" varchar(50) NOT NULL,
	"heading" varchar(120) NOT NULL,
	"body" text NOT NULL,
	"section" varchar(50),
	"created_by" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_notes" ADD CONSTRAINT "custom_notes_company_id_companies_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("company_id") ON DELETE cascade ON UPDATE no action;