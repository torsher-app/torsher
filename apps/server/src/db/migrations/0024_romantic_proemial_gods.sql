CREATE TABLE `tracker_episodes` (
	`title_id` text NOT NULL,
	`season` integer NOT NULL,
	`episode` integer NOT NULL,
	`first_seen_at` integer NOT NULL,
	`release_title` text NOT NULL,
	PRIMARY KEY(`title_id`, `season`, `episode`)
);
