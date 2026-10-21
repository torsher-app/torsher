CREATE TABLE `torrents` (
	`id` text PRIMARY KEY NOT NULL,
	`info_hash` text NOT NULL,
	`name` text NOT NULL,
	`source` text NOT NULL,
	`magnet` text,
	`torrent_file` blob,
	`files` text,
	`piece_length` integer,
	`status` text NOT NULL,
	`error` text,
	`in_engine` integer DEFAULT false NOT NULL,
	`added_at` integer NOT NULL,
	`last_access_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `torrents_info_hash_unique` ON `torrents` (`info_hash`);--> statement-breakpoint
CREATE TABLE `watch_states` (
	`torrent_id` text NOT NULL,
	`file_index` integer NOT NULL,
	`position` real NOT NULL,
	`duration` real,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`torrent_id`, `file_index`),
	FOREIGN KEY (`torrent_id`) REFERENCES `torrents`(`id`) ON UPDATE no action ON DELETE cascade
);
