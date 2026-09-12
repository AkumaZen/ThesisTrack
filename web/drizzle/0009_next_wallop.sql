ALTER TABLE "custom_notes" ADD COLUMN "blocks" jsonb DEFAULT '[]'::jsonb NOT NULL;
