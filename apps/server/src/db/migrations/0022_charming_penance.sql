CREATE TABLE `follow_history` (
	`id` text PRIMARY KEY NOT NULL,
	`follow_id` text,
	`title_id` text NOT NULL,
	`at` integer NOT NULL,
	`kind` text NOT NULL,
	`season` integer,
	`episodes` text,
	`release_title` text,
	`indexer_id` text,
	`torrent_id` text,
	`params` text NOT NULL,
	FOREIGN KEY (`follow_id`) REFERENCES `follows`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `follow_history_title_idx` ON `follow_history` (`title_id`,`at`);--> statement-breakpoint
CREATE INDEX `follow_history_at_idx` ON `follow_history` (`at`);--> statement-breakpoint
CREATE TABLE `release_blocklist` (
	`id` text PRIMARY KEY NOT NULL,
	`title_id` text NOT NULL,
	`info_hash` text NOT NULL,
	`details_url` text,
	`release_title` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer
);
--> statement-breakpoint
CREATE INDEX `release_blocklist_hash_idx` ON `release_blocklist` (`info_hash`);--> statement-breakpoint
ALTER TABLE `follow_episodes` ADD `downloaded_at` integer;--> statement-breakpoint
ALTER TABLE `indexers` ADD `backoff_until` integer;--> statement-breakpoint
ALTER TABLE `indexers` ADD `failure_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `torrents` ADD `origin` text DEFAULT 'search' NOT NULL;--> statement-breakpoint
UPDATE `torrents` SET `origin` = 'manual' WHERE `title_id` IS NULL OR `match_status` IS NOT NULL;