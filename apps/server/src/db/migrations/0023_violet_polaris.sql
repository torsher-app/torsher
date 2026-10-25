PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_follow_history` (
	`id` text PRIMARY KEY NOT NULL,
	`follow_id` text,
	`title_id` text,
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
INSERT INTO `__new_follow_history`("id", "follow_id", "title_id", "at", "kind", "season", "episodes", "release_title", "indexer_id", "torrent_id", "params") SELECT "id", "follow_id", "title_id", "at", "kind", "season", "episodes", "release_title", "indexer_id", "torrent_id", "params" FROM `follow_history`;--> statement-breakpoint
DROP TABLE `follow_history`;--> statement-breakpoint
ALTER TABLE `__new_follow_history` RENAME TO `follow_history`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `follow_history_title_idx` ON `follow_history` (`title_id`,`at`);--> statement-breakpoint
CREATE INDEX `follow_history_at_idx` ON `follow_history` (`at`);--> statement-breakpoint
ALTER TABLE `indexers` ADD `supports_rss` integer;--> statement-breakpoint
ALTER TABLE `indexers` ADD `rss_cursor` text;--> statement-breakpoint
ALTER TABLE `indexers` ADD `rss_checked_at` integer;--> statement-breakpoint
ALTER TABLE `indexers` ADD `rss_failures` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `indexers` ADD `priority` integer;