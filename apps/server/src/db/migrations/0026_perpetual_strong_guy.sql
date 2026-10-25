ALTER TABLE `follow_episodes` ADD `grabbed_title` text;--> statement-breakpoint
ALTER TABLE `follow_episodes` ADD `upgrade_from` text;--> statement-breakpoint
ALTER TABLE `media_files` ADD `replacement_torrent_id` text REFERENCES torrents(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `media_files` ADD `replacement_file_index` integer;--> statement-breakpoint
ALTER TABLE `media_files` ADD `replaced` text;