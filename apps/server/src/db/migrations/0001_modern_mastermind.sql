CREATE TABLE `meta_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`json` text NOT NULL,
	`fetched_at` integer NOT NULL
);
