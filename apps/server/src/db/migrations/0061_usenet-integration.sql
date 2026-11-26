CREATE TABLE `usenet_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`generation` text NOT NULL,
	`url` text NOT NULL,
	`encrypted_api_key` text NOT NULL,
	`category` text NOT NULL,
	`remote_root` text NOT NULL,
	`local_root` text NOT NULL,
	`lan_addresses` text DEFAULT '[]' NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`follow_enabled` integer DEFAULT false NOT NULL,
	`verified` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `usenet_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`client_generation` text NOT NULL,
	`source_id` text NOT NULL,
	`source_revision` text NOT NULL,
	`release_key` text NOT NULL,
	`release_title` text NOT NULL,
	`title_id` text NOT NULL,
	`season` integer DEFAULT 0 NOT NULL,
	`episode` integer DEFAULT 0 NOT NULL,
	`origin` text NOT NULL,
	`profile_id` text,
	`follow_id` text,
	`state` text NOT NULL,
	`active` integer NOT NULL,
	`nzo_id` text,
	`progress` real,
	`problem` text,
	`storage` text,
	`receipt` text,
	`media_file_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`media_file_id`) REFERENCES `media_files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usenet_jobs_active_target_idx` ON `usenet_jobs` (`title_id`,`season`,`episode`) WHERE "usenet_jobs"."active" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `usenet_jobs_nzo_idx` ON `usenet_jobs` (`client_generation`,`nzo_id`) WHERE "usenet_jobs"."nzo_id" is not null;--> statement-breakpoint
CREATE INDEX `usenet_jobs_active_idx` ON `usenet_jobs` (`active`,`state`);--> statement-breakpoint
ALTER TABLE `indexer_managers` ADD `import_newznab` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `indexer_managers` ADD `newznab_lan_addresses` text;--> statement-breakpoint
ALTER TABLE `indexers` ADD `protocol` text DEFAULT 'torznab' NOT NULL;--> statement-breakpoint
ALTER TABLE `indexers` ADD `lan_addresses` text;--> statement-breakpoint
ALTER TABLE `indexers` ADD `download_origins` text;