CREATE TABLE `title_external_ids` (
	`type` text NOT NULL,
	`tmdb_id` integer NOT NULL,
	`imdb_id` text,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`type`, `tmdb_id`)
);
--> statement-breakpoint
CREATE INDEX `title_external_ids_fetched_at_idx` ON `title_external_ids` (`fetched_at`);