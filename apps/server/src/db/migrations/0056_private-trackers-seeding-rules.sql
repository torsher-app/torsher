ALTER TABLE `indexers` ADD `known_privacy` text;--> statement-breakpoint
ALTER TABLE `indexers` ADD `is_private` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `indexers` ADD `allow_automation` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `indexers` ADD `min_seed_ratio` real;--> statement-breakpoint
ALTER TABLE `indexers` ADD `min_seed_time_minutes` integer;--> statement-breakpoint
ALTER TABLE `indexers` ADD `seed_criteria_mode` text;--> statement-breakpoint
ALTER TABLE `indexers` ADD `policy_customized` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `maintenance_groups` ADD `private_obligation_met` integer;--> statement-breakpoint
ALTER TABLE `torrents` ADD `source_indexer_id` text;--> statement-breakpoint
ALTER TABLE `torrents` ADD `source_indexer_name` text;--> statement-breakpoint
ALTER TABLE `torrents` ADD `primary_tracker_host` text;--> statement-breakpoint
ALTER TABLE `torrents` ADD `tracker_fingerprint` text;--> statement-breakpoint
ALTER TABLE `torrents` ADD `is_private` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `torrents` ADD `full_download` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `torrents` ADD `seed_obligations` text;--> statement-breakpoint
ALTER TABLE `torrents` ADD `verified_complete` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `torrents` ADD `start_announce_state` text;--> statement-breakpoint
ALTER TABLE `torrents` ADD `left_zero_accepted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `torrents` ADD `seeded_seconds` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `torrents` ADD `tracker_error_code` text;