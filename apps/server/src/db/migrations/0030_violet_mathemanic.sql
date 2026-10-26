ALTER TABLE `follow_episodes` ADD `picked` text;--> statement-breakpoint
ALTER TABLE `follow_episodes` ADD `picked_at` integer;--> statement-breakpoint
ALTER TABLE `follows` ADD `mode` text DEFAULT 'download' NOT NULL;