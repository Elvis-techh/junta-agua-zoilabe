-- "Deuda anterior": the months a house already owed when the app took over,
-- copied from the paper receipt book, each with its price (and its late fee
-- where the book shows one) fixed when it is entered. A month entered by
-- mistake is removed ("Quitar") with a reason: the row stays, and the month
-- is free to be entered again, so the one-row-per-month index counts only
-- months not removed. Nothing existing changes: the table starts empty.
--
-- The start month is saved once and never changed (owner, 13 November 2026),
-- so the database refuses a second `start_month` row in `settings`.
CREATE TABLE `owed_months` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`month` text NOT NULL,
	`price_centavos` integer NOT NULL,
	`late_fee_centavos` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text NOT NULL,
	`removed_at` text,
	`removed_by` text,
	`removed_reason` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`removed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "owed_months_first_day" CHECK(substr("owed_months"."month", 9, 2) = '01'),
	CONSTRAINT "owed_months_price" CHECK("owed_months"."price_centavos" > 0),
	CONSTRAINT "owed_months_late_fee" CHECK("owed_months"."late_fee_centavos" IS NULL OR "owed_months"."late_fee_centavos" >= 0),
	CONSTRAINT "owed_months_removed_reason" CHECK(("owed_months"."removed_at" IS NULL) = ("owed_months"."removed_reason" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owed_months_household_month_unique` ON `owed_months` (`household_id`,`month`) WHERE "owed_months"."removed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `settings_start_month_once` ON `settings` (`key`) WHERE "settings"."key" = 'start_month';