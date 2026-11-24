CREATE TABLE `subtitle_jobs` (
	`media_file_id` text NOT NULL,
	`source_revision` text NOT NULL,
	`language` text NOT NULL,
	`next_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	PRIMARY KEY(`media_file_id`, `source_revision`, `language`),
	FOREIGN KEY (`media_file_id`) REFERENCES `media_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `subtitle_jobs_next_idx` ON `subtitle_jobs` (`state`,`next_at`);--> statement-breakpoint
ALTER TABLE `downloaded_subtitles` ADD `media_file_id` text REFERENCES media_files(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `downloaded_subtitles` ADD `provider` text;--> statement-breakpoint
ALTER TABLE `downloaded_subtitles` ADD `provider_file` text;--> statement-breakpoint
ALTER TABLE `downloaded_subtitles` ADD `managed_name` text;--> statement-breakpoint
ALTER TABLE `downloaded_subtitles` ADD `hearing_impaired` integer;--> statement-breakpoint
ALTER TABLE `downloaded_subtitles` ADD `last_used_at` integer;--> statement-breakpoint
CREATE INDEX `downloaded_subtitles_media_idx` ON `downloaded_subtitles` (`media_file_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `downloaded_subtitles_provider_idx` ON `downloaded_subtitles` (`source_revision`,`provider`,`provider_file`,`owner_only`);
--> statement-breakpoint
CREATE TRIGGER downloaded_subtitle_delete_offsets
AFTER DELETE ON downloaded_subtitles
BEGIN
  DELETE FROM subtitle_offsets WHERE track_key = 'm' || OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER media_file_delete_subtitle_offsets
AFTER DELETE ON media_files
BEGIN
  DELETE FROM subtitle_offsets
  WHERE instr(source_revision, 'library:' || OLD.id || ':') = 1;
END;
