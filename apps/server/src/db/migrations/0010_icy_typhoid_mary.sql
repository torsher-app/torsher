CREATE TABLE `net_routes` (
	`id` text PRIMARY KEY NOT NULL,
	`match` text NOT NULL,
	`via` text NOT NULL,
	`proxy_address` text,
	`proxy_username` text,
	`proxy_password` text,
	`dns` text DEFAULT 'system' NOT NULL,
	`doh_url` text,
	`position` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `net_routes_match_unique` ON `net_routes` (`match`);--> statement-breakpoint
CREATE TABLE `server_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
