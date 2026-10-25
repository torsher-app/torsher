CREATE TABLE `tracked_topics` (
	`id` text PRIMARY KEY NOT NULL,
	`title_id` text NOT NULL,
	`indexer_id` text NOT NULL,
	`details_url` text NOT NULL,
	`torrent_id` text,
	`info_hash` text NOT NULL,
	`release_title` text NOT NULL,
	`season` integer,
	`episodes_to` integer,
	`episodes_total` integer,
	`refresh` text,
	`last_seen_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`indexer_id`) REFERENCES `indexers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`torrent_id`) REFERENCES `torrents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tracked_topics_key_idx` ON `tracked_topics` (`indexer_id`,`details_url`);--> statement-breakpoint
CREATE INDEX `tracked_topics_title_idx` ON `tracked_topics` (`title_id`);--> statement-breakpoint
ALTER TABLE `follow_seasons` ADD `topic_id` text REFERENCES tracked_topics(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `media_files` ADD `stale` integer DEFAULT false NOT NULL;