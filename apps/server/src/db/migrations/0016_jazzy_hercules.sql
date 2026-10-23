CREATE TABLE `libraries` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`managed` integer DEFAULT false NOT NULL,
	`exclude` text NOT NULL,
	`watch` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `library_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`path` text NOT NULL,
	`hint` text DEFAULT 'auto' NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL,
	`device` integer,
	`file_count` integer DEFAULT 0 NOT NULL,
	`scanned_at` integer,
	`error` text,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `library_hidden_profiles` (
	`library_id` text NOT NULL,
	`profile_id` text NOT NULL,
	PRIMARY KEY(`library_id`, `profile_id`),
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `media_files` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_id` text NOT NULL,
	`rel_path` text NOT NULL,
	`size` integer NOT NULL,
	`mtime` integer NOT NULL,
	`inode` integer,
	`state` text DEFAULT 'present' NOT NULL,
	`missing_since` integer,
	`torrent_id` text,
	`file_index` integer,
	`link_mode` text,
	`probe` text,
	`duration` real,
	`probed_at` integer,
	`probe_key` text,
	`title_id` text,
	`season` integer,
	`episode` integer,
	`episode_to` integer,
	`version` text,
	`match_status` text,
	`match_suggestion` text,
	`match_source` text,
	`match_group` text,
	`captured_at` integer,
	`captured_at_source` text,
	`album` text,
	`thumb` text,
	`added_at` integer NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `library_folders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`torrent_id`) REFERENCES `torrents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_files_folder_path_idx` ON `media_files` (`folder_id`,`rel_path`);--> statement-breakpoint
CREATE INDEX `media_files_title_idx` ON `media_files` (`title_id`,`season`,`episode`);--> statement-breakpoint
CREATE INDEX `media_files_torrent_idx` ON `media_files` (`torrent_id`,`file_index`);--> statement-breakpoint
CREATE INDEX `media_files_added_at_idx` ON `media_files` (`added_at`);--> statement-breakpoint
CREATE INDEX `media_files_album_idx` ON `media_files` (`album`,`captured_at`);--> statement-breakpoint
ALTER TABLE `title_progress` ADD `media_file_id` text;--> statement-breakpoint
ALTER TABLE `torrents` ADD `match_status` text;--> statement-breakpoint
ALTER TABLE `torrents` ADD `match_suggestion` text;