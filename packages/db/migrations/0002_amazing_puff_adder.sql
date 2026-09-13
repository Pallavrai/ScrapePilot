ALTER TABLE "listings" ADD COLUMN "changelog" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "sample_output" jsonb DEFAULT '[]'::jsonb NOT NULL;