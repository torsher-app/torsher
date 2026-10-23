CREATE TABLE `library_hidden_profiles` (
	`library_id` text NOT NULL,
	`profile_id` text NOT NULL,
	PRIMARY KEY(`library_id`, `profile_id`),
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `media_files` ADD `match_suggestion` text;