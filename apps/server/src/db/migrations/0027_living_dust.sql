ALTER TABLE `follow_episodes` ADD `notified_at` integer;--> statement-breakpoint
ALTER TABLE `indexers` ADD `backoff_since` integer;--> statement-breakpoint
UPDATE `follow_episodes` SET `notified_at` = COALESCE(`downloaded_at`, `first_seen_at`) WHERE `downloaded_at` IS NOT NULL OR `upgrade_from` IS NOT NULL;