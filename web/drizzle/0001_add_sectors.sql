CREATE TABLE "sectors" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"operating_model" "operating_model",
	"created_by" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sectors_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "sector_companies" (
	"sector_id" bigint NOT NULL,
	"company_id" varchar(50) NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sector_companies_sector_id_company_id_pk" PRIMARY KEY("sector_id","company_id")
);
--> statement-breakpoint
ALTER TABLE "sector_companies" ADD CONSTRAINT "sector_companies_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sector_companies" ADD CONSTRAINT "sector_companies_company_id_companies_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("company_id") ON DELETE cascade ON UPDATE no action;
