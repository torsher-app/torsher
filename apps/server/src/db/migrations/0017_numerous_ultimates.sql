CREATE TABLE `storage_moves` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`status` text NOT NULL,
	`bytes_total` integer DEFAULT 0 NOT NULL,
	`bytes_done` integer DEFAULT 0 NOT NULL,
	`items_total` integer DEFAULT 0 NOT NULL,
	`items_done` integer DEFAULT 0 NOT NULL,
	`error` text,
	`started_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
ALTER TABLE `library_folders` ADD `follows_env` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `torrents` ADD `download_dir` text;--> statement-breakpoint
UPDATE `library_folders` SET `follows_env` = 1 WHERE `library_id` IN (SELECT `id` FROM `libraries` WHERE `managed` = 1);
