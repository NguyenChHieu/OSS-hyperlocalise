ALTER TABLE "issue_sheet_issues" ADD COLUMN "resolution_reason" text;--> statement-breakpoint
ALTER TABLE "issue_sheet_issues" ADD COLUMN "resolved_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "issue_sheet_issues" ADD COLUMN "verifier_user_id" uuid;--> statement-breakpoint
ALTER TABLE "issue_sheet_issues" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issue_sheet_issues" ADD COLUMN "verified_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "issue_sheet_issues" ADD CONSTRAINT "issue_sheet_issues_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_sheet_issues" ADD CONSTRAINT "issue_sheet_issues_verifier_user_id_users_id_fk" FOREIGN KEY ("verifier_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_sheet_issues" ADD CONSTRAINT "issue_sheet_issues_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_issue_sheet_issues_verifier_status" ON "issue_sheet_issues" USING btree ("verifier_user_id","status");--> statement-breakpoint
-- HL-501: backfill legacy resolved rows so `resolution_reason IS NOT NULL` reliably means
-- "currently closed" going forward. wont_fix is untouched: that status is self-describing and
-- was never routed through a reason.
UPDATE "issue_sheet_issues" SET "resolution_reason" = 'unspecified' WHERE "status" = 'resolved';