CREATE TABLE `title_aliases` (
	`title_id` text NOT NULL,
	`value` text NOT NULL,
	`normalized` text NOT NULL,
	`lang` text,
	`kind` text NOT NULL,
	`synced_at` integer NOT NULL,
	PRIMARY KEY(`title_id`, `kind`, `value`)
);
--> statement-breakpoint
CREATE INDEX `title_aliases_normalized_idx` ON `title_aliases` (`normalized`);--> statement-breakpoint
CREATE INDEX `title_aliases_synced_at_idx` ON `title_aliases` (`synced_at`);--> statement-breakpoint
CREATE TABLE `title_progress` (
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
	PRIMARY KEY(`title_id`, `season`, `episode`),
	FOREIGN KEY (`torrent_id`) REFERENCES `torrents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `title_progress_updated_at_idx` ON `title_progress` (`title_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `title_voices` (
	`title_id` text NOT NULL,
	`season` integer NOT NULL,
	`studio` text,
	`type` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`title_id`, `season`)
);
