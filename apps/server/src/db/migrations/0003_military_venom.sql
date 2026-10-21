CREATE TABLE `indexer_managers` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`url` text NOT NULL,
	`api_key` text NOT NULL,
	`synced_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `indexer_managers_kind_url_idx` ON `indexer_managers` (`kind`,`url`);--> statement-breakpoint
CREATE TABLE `indexers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`api_key` text,
	`enabled` integer DEFAULT true NOT NULL,
	`manager_id` text,
	`external_id` text,
	`missing` integer DEFAULT false NOT NULL,
	`caps` text,
	`check_status` text,
	`checked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`manager_id`) REFERENCES `indexer_managers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `indexers_manager_external_idx` ON `indexers` (`manager_id`,`external_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `role` text DEFAULT 'user' NOT NULL;