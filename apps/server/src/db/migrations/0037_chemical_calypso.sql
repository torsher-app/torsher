CREATE TABLE `media_analysis` (
	`file_id` text PRIMARY KEY NOT NULL,
	`revision` text NOT NULL,
	`version` integer NOT NULL,
	`identity` text NOT NULL,
	`data` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `media_files`(`id`) ON UPDATE no action ON DELETE cascade
);
