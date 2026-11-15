CREATE TABLE `household_status_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` text NOT NULL,
	`status` text NOT NULL,
	`inactive_reason` text,
	`water_connection` text NOT NULL,
	`starts_on` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "household_status_changes_inactive_reason" CHECK("household_status_changes"."status" = 'active' OR "household_status_changes"."inactive_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `household_status_changes_household_idx` ON `household_status_changes` (`household_id`);--> statement-breakpoint
-- Households registered before the history existed: active, with the connection they have now, since the day they were registered (the paper form's date when typed from paper).
INSERT INTO `household_status_changes` (`household_id`, `status`, `inactive_reason`, `water_connection`, `starts_on`, `created_at`, `created_by`)
SELECT `id`, 'active', NULL, `water_connection`, coalesce(`paper_date`, substr(`created_at`, 1, 10)), `created_at`, NULL
FROM `households`;
--> statement-breakpoint
-- Those inactive now: inactive since their last deactivation in the history log (its UTC date), or since they were registered if the log has none.
INSERT INTO `household_status_changes` (`household_id`, `status`, `inactive_reason`, `water_connection`, `starts_on`, `created_by`)
SELECT h.`id`, 'inactive', h.`inactive_reason`, h.`water_connection`,
  coalesce(
    (SELECT substr(max(a.`occurred_at`), 1, 10) FROM `audit_log` a WHERE a.`entity_id` = h.`id` AND a.`action` = 'household.deactivated'),
    coalesce(h.`paper_date`, substr(h.`created_at`, 1, 10))
  ),
  NULL
FROM `households` h
WHERE h.`status` = 'inactive';
