CREATE TABLE `access_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`token_hash` text NOT NULL,
	`device_id` text,
	`label` text,
	`expires_at` text NOT NULL,
	`used_at` text,
	`last_used_at` text,
	`pin_confirmed_at` text,
	`revoked_at` text,
	`revoked_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_tokens_hash_unique` ON `access_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `access_tokens_user_idx` ON `access_tokens` (`user_id`,`kind`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`occurred_at` text NOT NULL,
	`actor_user_id` text,
	`actor_guest_id` text,
	`actor_name` text NOT NULL,
	`actor_role` text NOT NULL,
	`area` text NOT NULL,
	`action` text NOT NULL,
	`summary` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`before` text,
	`after` text,
	`reason` text,
	`device` text,
	`prev_hash` text NOT NULL,
	`hash` text NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_guest_id`) REFERENCES `guest_invitations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_log_occurred_idx` ON `audit_log` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_log_actor_idx` ON `audit_log` (`actor_user_id`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_kind_name_unique` ON `categories` (`kind`,`name`);--> statement-breakpoint
CREATE TABLE `fee_rates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`amount_centavos` integer NOT NULL,
	`starts_on` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fee_rates_amount" CHECK("fee_rates"."amount_centavos" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fee_rates_kind_start_unique` ON `fee_rates` (`kind`,`starts_on`);--> statement-breakpoint
CREATE TABLE `guest_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`guest_name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`permissions` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`revoked_by` text,
	`last_sign_in_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `guest_invitations_email_idx` ON `guest_invitations` (`email`);--> statement-breakpoint
CREATE TABLE `household_fees` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`monthly_amount_centavos` integer NOT NULL,
	`reason` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "household_fees_amount" CHECK("household_fees"."monthly_amount_centavos" >= 0)
);
--> statement-breakpoint
CREATE INDEX `household_fees_household_idx` ON `household_fees` (`household_id`);--> statement-breakpoint
CREATE TABLE `household_owners` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`person_id` text NOT NULL,
	`relation` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `household_owners_household_idx` ON `household_owners` (`household_id`);--> statement-breakpoint
CREATE TABLE `households` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`sector_id` integer NOT NULL,
	`references` text NOT NULL,
	`gps_lat` real,
	`gps_lng` real,
	`water_connection` text NOT NULL,
	`status` text NOT NULL,
	`inactive_reason` text,
	`paper_date` text,
	`paper_form_number` text,
	`submission_id` text NOT NULL,
	`last_verified_on` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	FOREIGN KEY (`sector_id`) REFERENCES `sectors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "households_inactive_reason" CHECK("households"."status" = 'active' OR "households"."inactive_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `households_code_unique` ON `households` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `households_submission_unique` ON `households` (`submission_id`);--> statement-breakpoint
CREATE TABLE `months` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`month` text NOT NULL,
	`status` text NOT NULL,
	`cash_counted_centavos` integer,
	`prepared_by` text,
	`prepared_at` text,
	`approved_by` text,
	`approved_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`prepared_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "months_first_day" CHECK(substr("months"."month", 9, 2) = '01'),
	CONSTRAINT "months_preparer_not_approver" CHECK("months"."approved_by" IS NULL OR "months"."approved_by" <> "months"."prepared_by")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `months_month_unique` ON `months` (`month`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`id_number` text NOT NULL,
	`phone` text,
	`phone_missing` text,
	`gender` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "people_id_number_digits" CHECK((length("people"."id_number") = 13 AND "people"."id_number" NOT GLOB '*[^0-9]*')),
	CONSTRAINT "people_phone_digits" CHECK("people"."phone" IS NULL OR (length("people"."phone") = 8 AND "people"."phone" NOT GLOB '*[^0-9]*')),
	CONSTRAINT "people_phone_or_reason" CHECK(("people"."phone" IS NULL) <> ("people"."phone_missing" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `people_id_number_unique` ON `people` (`id_number`);--> statement-breakpoint
CREATE TABLE `receipt_files` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `receipt_files_storage_key_unique` ON `receipt_files` (`storage_key`);--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_code` text NOT NULL,
	`permission` text NOT NULL,
	`granted` integer NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_by` text,
	PRIMARY KEY(`role_code`, `permission`),
	FOREIGN KEY (`role_code`) REFERENCES `roles`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sectors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sectors_name_unique` ON `sectors` (`name`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`effective_from` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `settings_key_idx` ON `settings` (`key`,`effective_from`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`category_id` integer NOT NULL,
	`household_id` text,
	`month_id` integer NOT NULL,
	`occurred_on` text NOT NULL,
	`amount_centavos` integer NOT NULL,
	`months_covered` text,
	`payment_method` text,
	`bank_reference` text,
	`paper_receipt_number` text,
	`payer_name` text,
	`supplier` text,
	`note` text,
	`reverses_id` text,
	`reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`month_id`) REFERENCES `months`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transactions_reversal_reason" CHECK("transactions"."reverses_id" IS NULL OR "transactions"."reason" IS NOT NULL),
	CONSTRAINT "transactions_transfer_reference" CHECK("transactions"."payment_method" IS NOT 'transfer' OR "transactions"."bank_reference" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `transactions_month_idx` ON `transactions` (`month_id`);--> statement-breakpoint
CREATE INDEX `transactions_household_idx` ON `transactions` (`household_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_reverses_unique` ON `transactions` (`reverses_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`role_code` text NOT NULL,
	`status` text NOT NULL,
	`pin_hash` text,
	`failed_pin_count` integer DEFAULT 0 NOT NULL,
	`locked_at` text,
	`last_login_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	FOREIGN KEY (`role_code`) REFERENCES `roles`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "users_phone_digits" CHECK((length("users"."phone") = 8 AND "users"."phone" NOT GLOB '*[^0-9]*'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_phone_unique` ON `users` (`phone`);