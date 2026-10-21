CREATE TABLE `storage_policy` (
	`id` integer PRIMARY KEY NOT NULL,
	`cache_limit_bytes` integer NOT NULL,
	`min_free_bytes` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `torrents` ADD `title_id` text;--> statement-breakpoint
ALTER TABLE `torrents` ADD `retention` text DEFAULT 'cache' NOT NULL;--> statement-breakpoint
ALTER TABLE `torrents` ADD `selected_files` text;--> statement-breakpoint
ALTER TABLE `torrents` ADD `pause_reason` text;