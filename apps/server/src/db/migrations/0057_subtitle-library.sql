CREATE TABLE `downloaded_subtitles` (
	`id` text PRIMARY KEY NOT NULL,
	`source_revision` text NOT NULL,
	`language` text,
	`title` text,
	`forced` integer NOT NULL,
	`owner_only` integer DEFAULT false NOT NULL,
	`bytes` integer NOT NULL,
	`sha256` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `downloaded_subtitles_content_idx` ON `downloaded_subtitles` (`source_revision`,`owner_only`,`sha256`,`language`,`forced`);--> statement-breakpoint
CREATE TABLE `subtitle_offsets` (
	`profile_id` text NOT NULL,
	`source_revision` text NOT NULL,
	`track_key` text NOT NULL,
	`offset_ms` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `source_revision`, `track_key`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "subtitle_offsets_range" CHECK("subtitle_offsets"."offset_ms" BETWEEN -30000 AND 30000)
);
