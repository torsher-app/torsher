CREATE TABLE `follow_episodes` (
	`follow_id` text NOT NULL,
	`season` integer NOT NULL,
	`episode` integer NOT NULL,
	`first_seen_at` integer NOT NULL,
	`wait_until` integer,
	`pending` text,
	`decisions` text,
	`torrent_id` text,
	`file_index` integer,
	`grabbed_at` integer,
	`manual` integer DEFAULT false NOT NULL,
	`state_note` text,
	PRIMARY KEY(`follow_id`, `season`, `episode`),
	FOREIGN KEY (`follow_id`) REFERENCES `follows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`torrent_id`) REFERENCES `torrents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `follow_profiles` (
	`follow_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`follow_id`, `profile_id`),
	FOREIGN KEY (`follow_id`) REFERENCES `follows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `follow_profiles_profile_idx` ON `follow_profiles` (`profile_id`);--> statement-breakpoint
CREATE TABLE `follow_seasons` (
	`follow_id` text NOT NULL,
	`season` integer NOT NULL,
	`best_quality_seen` text,
	`expected_total` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`follow_id`, `season`),
	FOREIGN KEY (`follow_id`) REFERENCES `follows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `follows` (
	`id` text PRIMARY KEY NOT NULL,
	`title_id` text NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`start_season` integer NOT NULL,
	`start_episode` integer NOT NULL,
	`voice_studio` text,
	`voice_strict` integer DEFAULT false NOT NULL,
	`require_russian` integer NOT NULL,
	`wait_hours` integer NOT NULL,
	`quality_preset` text DEFAULT 'best' NOT NULL,
	`created_by_profile_id` text,
	`next_search_at` integer,
	`last_search_at` integer,
	`search_step` integer DEFAULT 0 NOT NULL,
	`schedule_refreshed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `follows_title_id_unique` ON `follows` (`title_id`);--> statement-breakpoint
CREATE INDEX `follows_state_idx` ON `follows` (`state`);