-- Phones gain their country code. Every number so far is Honduran, since the
-- old check allowed nothing else, so each becomes +504 and its 8 digits (a
-- family with no phone stays NULL: NULL with anything added is still NULL).
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_people` (
	`id` text PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`id_number` text NOT NULL,
	`phone` text,
	`phone_missing` text,
	`gender` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "people_id_number_digits" CHECK((length("__new_people"."id_number") = 13 AND "__new_people"."id_number" NOT GLOB '*[^0-9]*')),
	CONSTRAINT "people_phone_digits" CHECK("__new_people"."phone" IS NULL OR (length("__new_people"."phone") BETWEEN 9 AND 16 AND "__new_people"."phone" GLOB '+*' AND substr("__new_people"."phone", 2) NOT GLOB '*[^0-9]*')),
	CONSTRAINT "people_phone_or_reason" CHECK(("__new_people"."phone" IS NULL) <> ("__new_people"."phone_missing" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_people`("id", "full_name", "id_number", "phone", "phone_missing", "gender", "created_at", "created_by") SELECT "id", "full_name", "id_number", '+504' || "phone", "phone_missing", "gender", "created_at", "created_by" FROM `people`;--> statement-breakpoint
DROP TABLE `people`;--> statement-breakpoint
ALTER TABLE `__new_people` RENAME TO `people`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `people_id_number_unique` ON `people` (`id_number`);--> statement-breakpoint
CREATE TABLE `__new_users` (
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
	CONSTRAINT "users_phone_digits" CHECK((length("__new_users"."phone") BETWEEN 9 AND 16 AND "__new_users"."phone" GLOB '+*' AND substr("__new_users"."phone", 2) NOT GLOB '*[^0-9]*'))
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "name", "phone", "role_code", "status", "pin_hash", "failed_pin_count", "locked_at", "last_login_at", "created_at", "created_by") SELECT "id", "name", '+504' || "phone", "role_code", "status", "pin_hash", "failed_pin_count", "locked_at", "last_login_at", "created_at", "created_by" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_phone_unique` ON `users` (`phone`);