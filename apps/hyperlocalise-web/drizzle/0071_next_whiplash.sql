CREATE TABLE "workspace_automation_memories" (
	"automation_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"revision_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT 'Initial version' NOT NULL,
	"include_org_knowledge" boolean DEFAULT true NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_automation_memories_content_length_check" CHECK (char_length("workspace_automation_memories"."content") <= 20000),
	CONSTRAINT "workspace_automation_memories_summary_length_check" CHECK (char_length("workspace_automation_memories"."summary") <= 160),
	CONSTRAINT "workspace_automation_memories_version_check" CHECK ("workspace_automation_memories"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "workspace_automation_memory_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"automation_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"summary" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspace_automation_memory_revisions_content_length_check" CHECK (char_length("workspace_automation_memory_revisions"."content") <= 20000),
	CONSTRAINT "workspace_automation_memory_revisions_summary_length_check" CHECK (char_length("workspace_automation_memory_revisions"."summary") <= 160),
	CONSTRAINT "workspace_automation_memory_revisions_version_check" CHECK ("workspace_automation_memory_revisions"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "workspace_automation_memories" ADD CONSTRAINT "workspace_automation_memories_automation_id_workspace_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."workspace_automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_automation_memories" ADD CONSTRAINT "workspace_automation_memories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_automation_memories" ADD CONSTRAINT "workspace_automation_memories_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_automation_memory_revisions" ADD CONSTRAINT "workspace_automation_memory_revisions_automation_id_workspace_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."workspace_automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_automation_memory_revisions" ADD CONSTRAINT "workspace_automation_memory_revisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_automation_memory_revisions" ADD CONSTRAINT "workspace_automation_memory_revisions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_automation_memories_revision_id_key" ON "workspace_automation_memories" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "idx_workspace_automation_memories_organization_id" ON "workspace_automation_memories" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_automation_memory_revisions_automation_version_key" ON "workspace_automation_memory_revisions" USING btree ("automation_id","version");--> statement-breakpoint
CREATE INDEX "idx_workspace_automation_memory_revisions_organization_id" ON "workspace_automation_memory_revisions" USING btree ("organization_id");