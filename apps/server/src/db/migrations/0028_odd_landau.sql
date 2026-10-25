ALTER TABLE `release_blocklist` ADD `episodes` text;--> statement-breakpoint
ALTER TABLE `release_blocklist` ADD `listed_page` text;--> statement-breakpoint
ALTER TABLE `release_blocklist` ADD `listed_title` text;--> statement-breakpoint
CREATE INDEX `follow_history_follow_kind_idx` ON `follow_history` (`follow_id`,`kind`,`at`);