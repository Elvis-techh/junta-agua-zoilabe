CREATE TABLE `opening_balances` (
	`id` text PRIMARY KEY NOT NULL,
	`month` text NOT NULL,
	`cash_centavos` integer NOT NULL,
	`bank_centavos` integer NOT NULL,
	`replaces_id` text,
	`reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`replaces_id`) REFERENCES `opening_balances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "opening_balances_first_day" CHECK(substr("opening_balances"."month", 9, 2) = '01'),
	CONSTRAINT "opening_balances_not_negative" CHECK("opening_balances"."cash_centavos" >= 0 AND "opening_balances"."bank_centavos" >= 0),
	CONSTRAINT "opening_balances_correction_reason" CHECK(("opening_balances"."replaces_id" IS NULL) = ("opening_balances"."reason" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `opening_balances_one_chain` ON `opening_balances` (coalesce("replaces_id", ''));