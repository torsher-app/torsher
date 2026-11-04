ALTER TABLE `devices` ADD `purpose` text DEFAULT 'viewer' NOT NULL;--> statement-breakpoint
ALTER TABLE `devices` ADD `owner_session_version` integer;