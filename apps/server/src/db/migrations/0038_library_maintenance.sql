CREATE TABLE `maintenance_files` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`kind` text NOT NULL,
	`root` text NOT NULL,
	`root_device` text,
	`root_inode` integer,
	`path` text NOT NULL,
	`device` text NOT NULL,
	`inode` integer NOT NULL,
	`size` integer NOT NULL,
	`mtime` integer NOT NULL,
	`media_file_id` text,
	`file_index` integer NOT NULL,
	`episodes` text NOT NULL,
	`link_mode` text,
	FOREIGN KEY (`group_id`) REFERENCES `maintenance_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `maintenance_files_media_idx` ON `maintenance_files` (`media_file_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `maintenance_files_group_path_idx` ON `maintenance_files` (`group_id`,`path`);--> statement-breakpoint
CREATE TABLE `maintenance_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`title_id` text NOT NULL,
	`initial_info_hash` text NOT NULL,
	`torrent_files` text NOT NULL,
	`piece_count` integer,
	`source_root` text NOT NULL,
	`source_root_device` text,
	`source_root_inode` integer,
	`source_evicted_at` integer,
	`torrent_id` text,
	`origin` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`identity_uncertain` integer DEFAULT false NOT NULL,
	`manual_protection` integer DEFAULT false NOT NULL,
	`selected_files` text NOT NULL,
	`seed_rule` text,
	`completed_at` integer,
	`uploaded` integer,
	`denominator` integer,
	`last_activity_at` integer,
	`eligible_since` integer,
	`eligibility_fingerprint` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`torrent_id`) REFERENCES `torrents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `maintenance_groups_hash_idx` ON `maintenance_groups` (`initial_info_hash`);--> statement-breakpoint
CREATE INDEX `maintenance_groups_torrent_idx` ON `maintenance_groups` (`torrent_id`);--> statement-breakpoint
CREATE INDEX `maintenance_groups_title_idx` ON `maintenance_groups` (`title_id`);--> statement-breakpoint
CREATE TABLE `maintenance_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`title_id` text NOT NULL,
	`group_revision` integer NOT NULL,
	`rule_revision` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`manifest` text NOT NULL,
	`episodes` text NOT NULL,
	`state` text NOT NULL,
	`volumes` text NOT NULL,
	`engine_stage` text DEFAULT 'unknown' NOT NULL,
	`results` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `maintenance_rules` (
	`inherits` integer DEFAULT false NOT NULL,
	`title_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`days` integer NOT NULL,
	`keep_last` integer,
	`profile_ids` text NOT NULL,
	`roster_fingerprint` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `maintenance_suppressions` (
	`title_id` text NOT NULL,
	`season` integer NOT NULL,
	`episode` integer NOT NULL,
	`status` text NOT NULL,
	`operation_id` text NOT NULL,
	PRIMARY KEY(`title_id`, `season`, `episode`)
);
--> statement-breakpoint
ALTER TABLE `title_progress` ADD `last_played_at` integer;