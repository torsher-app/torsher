CREATE TABLE `device_pairings` (
	`id` text PRIMARY KEY NOT NULL,
	`secret_hash` text NOT NULL,
	`code` text NOT NULL,
	`state` text NOT NULL,
	`type` text NOT NULL,
	`name` text,
	`ip` text,
	`user_agent` text,
	`approved_by` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_pairings_secret_hash_unique` ON `device_pairings` (`secret_hash`);--> statement-breakpoint
CREATE INDEX `device_pairings_code_idx` ON `device_pairings` (`code`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`token_hash` text NOT NULL,
	`profile_id` text,
	`last_ip` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`last_seen_at` integer,
	`last_stream_at` integer,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_token_hash_unique` ON `devices` (`token_hash`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`language` text,
	`pin_hash` text,
	`age_limit` integer,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `profiles` (`id`, `name`, `color`, `position`, `created_at`)
SELECT
	lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random() % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	`name`,
	'violet',
	0,
	CAST((julianday('now') - 2440587.5) * 86400000 AS integer)
FROM `users`
WHERE NOT EXISTS (SELECT 1 FROM `profiles`)
ORDER BY `created_at`
LIMIT 1;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_title_progress` (
	`profile_id` text NOT NULL,
	`title_id` text NOT NULL,
	`season` integer NOT NULL,
	`episode` integer NOT NULL,
	`position` real NOT NULL,
	`duration` real,
	`torrent_id` text,
	`file_index` integer,
	`voice_studio` text,
	`voice_type` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `title_id`, `season`, `episode`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`torrent_id`) REFERENCES `torrents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_title_progress`("profile_id", "title_id", "season", "episode", "position", "duration", "torrent_id", "file_index", "voice_studio", "voice_type", "updated_at") SELECT (SELECT `id` FROM `profiles` ORDER BY `position`, `created_at` LIMIT 1), "title_id", "season", "episode", "position", "duration", "torrent_id", "file_index", "voice_studio", "voice_type", "updated_at" FROM `title_progress` WHERE EXISTS (SELECT 1 FROM `profiles`);--> statement-breakpoint
DROP TABLE `title_progress`;--> statement-breakpoint
ALTER TABLE `__new_title_progress` RENAME TO `title_progress`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `title_progress_updated_at_idx` ON `title_progress` (`profile_id`,`title_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `__new_watch_states` (
	`profile_id` text NOT NULL,
	`torrent_id` text NOT NULL,
	`file_index` integer NOT NULL,
	`position` real NOT NULL,
	`duration` real,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `torrent_id`, `file_index`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`torrent_id`) REFERENCES `torrents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_watch_states`("profile_id", "torrent_id", "file_index", "position", "duration", "updated_at") SELECT (SELECT `id` FROM `profiles` ORDER BY `position`, `created_at` LIMIT 1), "torrent_id", "file_index", "position", "duration", "updated_at" FROM `watch_states` WHERE EXISTS (SELECT 1 FROM `profiles`);--> statement-breakpoint
DROP TABLE `watch_states`;--> statement-breakpoint
ALTER TABLE `__new_watch_states` RENAME TO `watch_states`;