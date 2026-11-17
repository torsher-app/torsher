CREATE TABLE `watch_events` (
	`profile_id` text NOT NULL,
	`client_id` text NOT NULL,
	`resource` text NOT NULL,
	`sequence` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `client_id`, `resource`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
