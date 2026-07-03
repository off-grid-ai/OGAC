ALTER TABLE "studio_templates" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "studio_templates" ADD COLUMN "published" boolean DEFAULT false NOT NULL;