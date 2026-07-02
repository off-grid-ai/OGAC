CREATE TABLE "gateway_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"secret" boolean DEFAULT false NOT NULL,
	"live_reload" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL
);
