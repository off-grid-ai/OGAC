CREATE TABLE "app_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'default' NOT NULL,
	"app_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"trigger" jsonb DEFAULT '{"kind":"on-demand"}'::jsonb NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcome" text DEFAULT '' NOT NULL,
	"provenance" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "apps" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'default' NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"slug" text,
	"published" boolean DEFAULT false NOT NULL,
	"trigger" jsonb DEFAULT '{"kind":"on-demand"}'::jsonb NOT NULL,
	"input_form" jsonb,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'default' NOT NULL,
	"label" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"connector_id" text NOT NULL,
	"resource" text NOT NULL,
	"op_hints" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_nodes" (
	"name" text PRIMARY KEY NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 7878 NOT NULL,
	"role" text DEFAULT 'gateway' NOT NULL,
	"kind" text DEFAULT 'chat' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"primary_gguf" text DEFAULT '' NOT NULL,
	"mmproj_gguf" text DEFAULT '' NOT NULL,
	"model_id" text DEFAULT '' NOT NULL,
	"context_size" integer,
	"vision" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provit_repos" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'default' NOT NULL,
	"owner_id" text DEFAULT '' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"url" text NOT NULL,
	"features" integer DEFAULT 0 NOT NULL,
	"test_files" integer DEFAULT 0 NOT NULL,
	"screens" integer DEFAULT 0 NOT NULL,
	"cases" integer DEFAULT 0 NOT NULL,
	"plan" jsonb,
	"mapped_by" text,
	"mapped_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provit_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'default' NOT NULL,
	"owner_id" text DEFAULT '' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"repo_id" text,
	"surface" text,
	"model" text,
	"direction" text,
	"headline" text,
	"frames" integer DEFAULT 0 NOT NULL,
	"flagged" integer DEFAULT 0 NOT NULL,
	"video" text,
	"narrative" text,
	"payload" jsonb,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provit_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"org_id" text DEFAULT 'default' NOT NULL,
	"owner_id" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked" boolean DEFAULT false NOT NULL,
	CONSTRAINT "provit_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "provit_verdicts" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"idx" integer NOT NULL,
	"frame_range" text,
	"bad" boolean DEFAULT false NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "chat_artifact_versions" ALTER COLUMN "code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_artifacts" ALTER COLUMN "code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_artifact_versions" ADD COLUMN "code_key" text;--> statement-breakpoint
ALTER TABLE "chat_artifact_versions" ADD COLUMN "code_hash" text;--> statement-breakpoint
ALTER TABLE "chat_artifacts" ADD COLUMN "code_key" text;--> statement-breakpoint
ALTER TABLE "chat_artifacts" ADD COLUMN "code_hash" text;--> statement-breakpoint
ALTER TABLE "org_knowledge_docs" ADD COLUMN "file_url" text;--> statement-breakpoint
ALTER TABLE "org_knowledge_docs" ADD COLUMN "mime" text;--> statement-breakpoint
CREATE INDEX "app_runs_app_idx" ON "app_runs" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "app_runs_org_idx" ON "app_runs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "apps_org_idx" ON "apps" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "apps_slug_idx" ON "apps" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "data_domains_org_idx" ON "data_domains" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "data_domains_connector_idx" ON "data_domains" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX "provit_repos_org_idx" ON "provit_repos" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "provit_repos_vis_idx" ON "provit_repos" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "provit_runs_repo_idx" ON "provit_runs" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "provit_runs_org_idx" ON "provit_runs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "provit_tokens_hash_idx" ON "provit_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "provit_verdicts_run_idx" ON "provit_verdicts" USING btree ("run_id");