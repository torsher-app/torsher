CREATE TABLE `collection_hidden_profiles` (
	`collection_id` text NOT NULL,
	`profile_id` text NOT NULL,
	PRIMARY KEY(`collection_id`, `profile_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `collection_titles` (
	`collection_id` text NOT NULL,
	`title_id` text NOT NULL,
	`added_at` integer NOT NULL,
	`added_by_profile_id` text,
	PRIMARY KEY(`collection_id`, `title_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `collection_titles_added_idx` ON `collection_titles` (`collection_id`,`added_at`);--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`show_on_home` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collections_name_key_idx` ON `collections` (`name_key`);--> statement-breakpoint
CREATE TABLE `profile_titles` (
	`profile_id` text NOT NULL,
	`title_id` text NOT NULL,
	`watchlist_at` integer,
	`favorite_at` integer,
	`rating` integer,
	`rated_at` integer,
	`dropped_at` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `title_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `profile_titles_watchlist_idx` ON `profile_titles` (`profile_id`,`watchlist_at`);--> statement-breakpoint
CREATE INDEX `profile_titles_favorite_idx` ON `profile_titles` (`profile_id`,`favorite_at`);--> statement-breakpoint
CREATE INDEX `profile_titles_rated_idx` ON `profile_titles` (`profile_id`,`rated_at`);--> statement-breakpoint
ALTER TABLE `profiles` ADD `poster_rating` text DEFAULT 'own' NOT NULL;