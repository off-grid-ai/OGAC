ALTER TABLE "governance_items" ADD COLUMN "org_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "masking_rules" ADD COLUMN "org_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "routing_rules" ADD COLUMN "org_id" text DEFAULT 'default' NOT NULL;