CREATE TABLE `payment_months` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`household_id` text NOT NULL,
	`month` text NOT NULL,
	`amount_centavos` integer NOT NULL,
	`price_centavos` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payment_months_first_day" CHECK(substr("payment_months"."month", 9, 2) = '01'),
	CONSTRAINT "payment_months_price" CHECK("payment_months"."price_centavos" >= 0),
	CONSTRAINT "payment_months_amount" CHECK("payment_months"."amount_centavos" <> 0)
);
--> statement-breakpoint
CREATE INDEX `payment_months_household_idx` ON `payment_months` (`household_id`,`month`);--> statement-breakpoint
CREATE INDEX `payment_months_transaction_idx` ON `payment_months` (`transaction_id`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `submission_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_submission_unique` ON `transactions` (`submission_id`);