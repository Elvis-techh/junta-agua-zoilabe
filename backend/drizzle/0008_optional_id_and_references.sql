PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_people` (
	`id` text PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`id_number` text,
	`phone` text,
	`phone_missing` text,
	`gender` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "people_id_number_digits" CHECK("__new_people"."id_number" IS NULL OR (length("__new_people"."id_number") = 13 AND "__new_people"."id_number" NOT GLOB '*[^0-9]*')),
	CONSTRAINT "people_phone_digits" CHECK("__new_people"."phone" IS NULL OR (length("__new_people"."phone") BETWEEN 9 AND 16 AND "__new_people"."phone" GLOB '+*' AND substr("__new_people"."phone", 2) NOT GLOB '*[^0-9]*')),
	CONSTRAINT "people_phone_or_reason" CHECK(("__new_people"."phone" IS NULL) <> ("__new_people"."phone_missing" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_people`("id", "full_name", "id_number", "phone", "phone_missing", "gender", "created_at", "created_by") SELECT "id", "full_name", "id_number", "phone", "phone_missing", "gender", "created_at", "created_by" FROM `people`;--> statement-breakpoint
DROP TABLE `people`;--> statement-breakpoint
ALTER TABLE `__new_people` RENAME TO `people`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `people_id_number_unique` ON `people` (`id_number`);--> statement-breakpoint
CREATE TABLE `__new_households` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`sector_id` integer NOT NULL,
	`references` text,
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
	CONSTRAINT "households_inactive_reason" CHECK("__new_households"."status" = 'active' OR "__new_households"."inactive_reason" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_households`("id", "code", "sector_id", "references", "gps_lat", "gps_lng", "water_connection", "status", "inactive_reason", "paper_date", "paper_form_number", "submission_id", "last_verified_on", "created_at", "created_by") SELECT "id", "code", "sector_id", "references", "gps_lat", "gps_lng", "water_connection", "status", "inactive_reason", "paper_date", "paper_form_number", "submission_id", "last_verified_on", "created_at", "created_by" FROM `households`;--> statement-breakpoint
DROP TABLE `households`;--> statement-breakpoint
ALTER TABLE `__new_households` RENAME TO `households`;--> statement-breakpoint
CREATE UNIQUE INDEX `households_code_unique` ON `households` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `households_submission_unique` ON `households` (`submission_id`);