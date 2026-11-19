ALTER TABLE `months` ADD `expected_cash_centavos` integer;--> statement-breakpoint
ALTER TABLE `months` ADD `cash_difference_reason` text;--> statement-breakpoint
ALTER TABLE `months` ADD `returned_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `months` ADD `returned_at` text;--> statement-breakpoint
ALTER TABLE `months` ADD `returned_reason` text;