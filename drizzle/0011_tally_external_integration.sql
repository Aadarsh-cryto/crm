CREATE TABLE "integration_sync_records" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"direction" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"external_id" text,
	"external_guid" text,
	"voucher_type" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"request_payload" jsonb DEFAULT '{}'::jsonb,
	"response_payload" jsonb DEFAULT '{}'::jsonb,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_entity_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"entity_type" text NOT NULL,
	"local_id" text NOT NULL,
	"external_id" text NOT NULL,
	"external_guid" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_integration_sync_provider_entity" ON "integration_sync_records" USING btree ("provider","entity_type","entity_id");
--> statement-breakpoint
CREATE INDEX "idx_integration_sync_provider_status" ON "integration_sync_records" USING btree ("provider","status");
--> statement-breakpoint
CREATE INDEX "idx_integration_sync_entity" ON "integration_sync_records" USING btree ("entity_type","entity_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_integration_mapping_provider_entity" ON "integration_entity_mappings" USING btree ("provider","entity_type","local_id");
--> statement-breakpoint
CREATE INDEX "idx_integration_mapping_external" ON "integration_entity_mappings" USING btree ("provider","entity_type","external_id");
