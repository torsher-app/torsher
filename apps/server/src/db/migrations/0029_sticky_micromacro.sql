PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_release_blocklist` (
	`id` text PRIMARY KEY NOT NULL,
	`title_id` text NOT NULL,
	`info_hash` text,
	`details_url` text,
	`release_title` text NOT NULL,
	`reason` text NOT NULL,
	`episodes` text,
	`listings` text,
	`created_at` integer NOT NULL,
	`expires_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_release_blocklist`("id", "title_id", "info_hash", "details_url", "release_title", "reason", "episodes", "listings", "created_at", "expires_at") SELECT "id", "title_id", "info_hash", "details_url", "release_title", "reason", "episodes", NULL, "created_at", "expires_at" FROM `release_blocklist`;--> statement-breakpoint
DROP TABLE `release_blocklist`;--> statement-breakpoint
ALTER TABLE `__new_release_blocklist` RENAME TO `release_blocklist`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `release_blocklist_hash_idx` ON `release_blocklist` (`info_hash`);