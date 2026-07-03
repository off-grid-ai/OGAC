ALTER TABLE "datasets" ADD COLUMN "org_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "tools" ADD COLUMN "org_id" text DEFAULT 'default' NOT NULL;