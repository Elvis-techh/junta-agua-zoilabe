-- A fee amount can be removed ("Quitar") until a payment covers its month:
-- the row stays, with when, who and why. Every amount saved so far is still
-- in force, so the three new columns start empty (NULL), not copied: the old
-- table does not have them. The month of a removed amount is free again, so
-- the one-amount-per-month index now counts only amounts not removed.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_fee_rates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`amount_centavos` integer NOT NULL,
	`starts_on` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	`removed_at` text,
	`removed_by` text,
	`removed_reason` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`removed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fee_rates_amount" CHECK("__new_fee_rates"."amount_centavos" >= 0),
	CONSTRAINT "fee_rates_removed_reason" CHECK(("__new_fee_rates"."removed_at" IS NULL) = ("__new_fee_rates"."removed_reason" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_fee_rates`("id", "kind", "amount_centavos", "starts_on", "created_at", "created_by", "removed_at", "removed_by", "removed_reason") SELECT "id", "kind", "amount_centavos", "starts_on", "created_at", "created_by", NULL, NULL, NULL FROM `fee_rates`;--> statement-breakpoint
DROP TABLE `fee_rates`;--> statement-breakpoint
ALTER TABLE `__new_fee_rates` RENAME TO `fee_rates`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `fee_rates_kind_start_unique` ON `fee_rates` (`kind`,`starts_on`) WHERE "fee_rates"."removed_at" IS NULL;