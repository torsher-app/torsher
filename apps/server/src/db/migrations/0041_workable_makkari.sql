CREATE TABLE `playback_preferences` (
	`profile_id` text NOT NULL,
	`title_id` text NOT NULL,
	`audio` text,
	`subtitles` text,
	PRIMARY KEY(`profile_id`, `title_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
