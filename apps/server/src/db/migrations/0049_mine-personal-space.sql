CREATE TABLE `cycle_playback_facts` (
	`profile_id` text NOT NULL,
	`title_id` text NOT NULL,
	`season` integer NOT NULL,
	`episode` integer NOT NULL,
	`watched_at` integer,
	`last_played_at` integer,
	`updated_at` integer NOT NULL,
	`mutation_token` text,
	PRIMARY KEY(`profile_id`, `title_id`, `season`, `episode`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cycle_playback_facts_episode_check" CHECK("cycle_playback_facts"."season" >= 0 AND "cycle_playback_facts"."episode" > 0),
	CONSTRAINT "cycle_playback_facts_time_check" CHECK("cycle_playback_facts"."last_played_at" IS NOT NULL OR "cycle_playback_facts"."watched_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `cycle_progress` (
	`profile_id` text NOT NULL,
	`cycle_id` text NOT NULL,
	`season` integer NOT NULL,
	`episode` integer NOT NULL,
	`position` real NOT NULL,
	`duration` real,
	`source` text,
	`voice_studio` text,
	`voice_type` text,
	`updated_at` integer NOT NULL,
	`mutation_token` text,
	PRIMARY KEY(`profile_id`, `cycle_id`, `season`, `episode`),
	FOREIGN KEY (`profile_id`,`cycle_id`) REFERENCES `rewatch_cycles`(`profile_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cycle_progress_episode_check" CHECK("cycle_progress"."season" >= 0 AND "cycle_progress"."episode" > 0),
	CONSTRAINT "cycle_progress_time_check" CHECK("cycle_progress"."position" >= 0 AND "cycle_progress"."duration" >= 0)
);
--> statement-breakpoint
CREATE TABLE `diary_entries` (
	`profile_id` text NOT NULL,
	`id` text NOT NULL,
	`title_id` text NOT NULL,
	`season` integer NOT NULL,
	`episode` integer NOT NULL,
	`precision` text NOT NULL,
	`instant` integer,
	`day` text,
	`origin` text NOT NULL,
	`origin_key` text,
	`rewatch` integer DEFAULT false NOT NULL,
	`note` text,
	`viewing_context` text,
	`context` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`mutation_token` text,
	PRIMARY KEY(`profile_id`, `id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "diary_entries_date_check" CHECK(("diary_entries"."precision" = 'instant' AND "diary_entries"."instant" IS NOT NULL AND "diary_entries"."day" IS NULL)
        OR ("diary_entries"."precision" = 'day' AND "diary_entries"."instant" IS NULL AND "diary_entries"."day" IS NOT NULL)
        OR ("diary_entries"."precision" = 'unknown' AND "diary_entries"."instant" IS NULL AND "diary_entries"."day" IS NULL)),
	CONSTRAINT "diary_entries_episode_check" CHECK("diary_entries"."season" >= 0 AND "diary_entries"."episode" >= 0 AND ("diary_entries"."episode" > 0 OR "diary_entries"."season" = 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `diary_entries_origin_idx` ON `diary_entries` (`profile_id`,`origin`,`origin_key`) WHERE "diary_entries"."origin_key" is not null;--> statement-breakpoint
CREATE INDEX `diary_entries_instant_idx` ON `diary_entries` (`profile_id`,`instant`,`id`);--> statement-breakpoint
CREATE INDEX `diary_entries_day_idx` ON `diary_entries` (`profile_id`,`day`,`id`);--> statement-breakpoint
CREATE INDEX `diary_entries_title_idx` ON `diary_entries` (`profile_id`,`title_id`,`season`,`episode`);--> statement-breakpoint
CREATE TABLE `diary_seen` (
	`profile_id` text NOT NULL,
	`title_id` text NOT NULL,
	`season` integer NOT NULL,
	`episode` integer NOT NULL,
	`mutation_token` text,
	PRIMARY KEY(`profile_id`, `title_id`, `season`, `episode`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "diary_seen_episode_check" CHECK("diary_seen"."season" >= 0 AND "diary_seen"."episode" >= 0 AND ("diary_seen"."episode" > 0 OR "diary_seen"."season" = 0))
);
--> statement-breakpoint
CREATE TABLE `mine_profile_preferences` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`start_section` text NOT NULL,
	`updated_at` integer NOT NULL,
	`mutation_token` text,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `mine_title_preferences` (
	`profile_id` text NOT NULL,
	`title_id` text NOT NULL,
	`note` text,
	`continuation` text DEFAULT 'normal' NOT NULL,
	`not_interested` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	`mutation_token` text,
	PRIMARY KEY(`profile_id`, `title_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mine_title_preferences_continuation_check" CHECK("mine_title_preferences"."continuation" IN ('normal', 'paused', 'hidden'))
);
--> statement-breakpoint
CREATE TABLE `rewatch_cycles` (
	`profile_id` text NOT NULL,
	`id` text NOT NULL,
	`title_id` text NOT NULL,
	`start_season` integer NOT NULL,
	`start_episode` integer NOT NULL,
	`target_season` integer NOT NULL,
	`target_episode` integer NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`mutation_token` text,
	PRIMARY KEY(`profile_id`, `id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "rewatch_cycles_state_check" CHECK("rewatch_cycles"."state" IN ('active', 'paused', 'ended')),
	CONSTRAINT "rewatch_cycles_episode_check" CHECK("rewatch_cycles"."start_season" >= 0 AND "rewatch_cycles"."start_episode" > 0
        AND "rewatch_cycles"."target_season" >= 0 AND "rewatch_cycles"."target_episode" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rewatch_cycles_unfinished_idx` ON `rewatch_cycles` (`profile_id`,`title_id`) WHERE "rewatch_cycles"."state" IN ('active', 'paused');--> statement-breakpoint
CREATE INDEX `rewatch_cycles_title_idx` ON `rewatch_cycles` (`profile_id`,`title_id`);--> statement-breakpoint
ALTER TABLE `profile_titles` ADD `mutation_token` text;--> statement-breakpoint
ALTER TABLE `title_progress` ADD `mutation_token` text;
--> statement-breakpoint
-- Legacy rows start with NULL. Every subsequent mutation gets a new local
-- version, including writes that keep updated_at and implicit FK updates.
-- The WHEN guard prevents recursion on the version-only UPDATE.
CREATE TRIGGER `title_progress_stamp_insert`
AFTER INSERT ON `title_progress`
BEGIN
  UPDATE `title_progress` SET `mutation_token` = lower(hex(randomblob(16)))
  WHERE `profile_id` = NEW.`profile_id` AND `title_id` = NEW.`title_id` AND `season` = NEW.`season` AND `episode` = NEW.`episode`;
END;
--> statement-breakpoint
CREATE TRIGGER `title_progress_stamp_update`
AFTER UPDATE ON `title_progress` WHEN NEW.`mutation_token` IS OLD.`mutation_token`
BEGIN
  UPDATE `title_progress` SET `mutation_token` = lower(hex(randomblob(16)))
  WHERE `profile_id` = NEW.`profile_id` AND `title_id` = NEW.`title_id` AND `season` = NEW.`season` AND `episode` = NEW.`episode`;
END;
--> statement-breakpoint
CREATE TRIGGER `profile_titles_stamp_insert`
AFTER INSERT ON `profile_titles`
BEGIN
  UPDATE `profile_titles` SET `mutation_token` = lower(hex(randomblob(16)))
  WHERE `profile_id` = NEW.`profile_id` AND `title_id` = NEW.`title_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `profile_titles_stamp_update`
AFTER UPDATE ON `profile_titles` WHEN NEW.`mutation_token` IS OLD.`mutation_token`
BEGIN
  UPDATE `profile_titles` SET `mutation_token` = lower(hex(randomblob(16)))
  WHERE `profile_id` = NEW.`profile_id` AND `title_id` = NEW.`title_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `diary_entries_stamp_insert`
AFTER INSERT ON `diary_entries`
BEGIN
  UPDATE `diary_entries` SET `mutation_token` = lower(hex(randomblob(16)))
  WHERE `profile_id` = NEW.`profile_id` AND `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `diary_entries_stamp_update`
AFTER UPDATE ON `diary_entries` WHEN NEW.`mutation_token` IS OLD.`mutation_token`
BEGIN
  UPDATE `diary_entries` SET `mutation_token` = lower(hex(randomblob(16)))
  WHERE `profile_id` = NEW.`profile_id` AND `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `diary_seen_stamp_insert`
AFTER INSERT ON `diary_seen`
BEGIN
  UPDATE `diary_seen` SET `mutation_token` = lower(hex(randomblob(16)))
  WHERE `profile_id` = NEW.`profile_id` AND `title_id` = NEW.`title_id` AND `season` = NEW.`season` AND `episode` = NEW.`episode`;
END;
--> statement-breakpoint
CREATE TRIGGER `diary_seen_stamp_update`
AFTER UPDATE ON `diary_seen` WHEN NEW.`mutation_token` IS OLD.`mutation_token`
BEGIN
  UPDATE `diary_seen` SET `mutation_token` = lower(hex(randomblob(16)))
  WHERE `profile_id` = NEW.`profile_id` AND `title_id` = NEW.`title_id` AND `season` = NEW.`season` AND `episode` = NEW.`episode`;
END;
--> statement-breakpoint
CREATE TRIGGER `rewatch_cycles_stamp_insert`
AFTER INSERT ON `rewatch_cycles`
BEGIN
  UPDATE `rewatch_cycles` SET `mutation_token` = lower(hex(randomblob(16)))
  WHERE `profile_id` = NEW.`profile_id` AND `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `rewatch_cycles_stamp_update`
AFTER UPDATE ON `rewatch_cycles` WHEN NEW.`mutation_token` IS OLD.`mutation_token`
BEGIN
  UPDATE `rewatch_cycles` SET `mutation_token` = lower(hex(randomblob(16)))
  WHERE `profile_id` = NEW.`profile_id` AND `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `cycle_progress_stamp_insert`
AFTER INSERT ON `cycle_progress`
BEGIN
  UPDATE `cycle_progress` SET `mutation_token` = lower(hex(randomblob(16)))
  WHERE `profile_id` = NEW.`profile_id` AND `cycle_id` = NEW.`cycle_id` AND `season` = NEW.`season` AND `episode` = NEW.`episode`;
END;
--> statement-breakpoint
CREATE TRIGGER `cycle_progress_stamp_update`
AFTER UPDATE ON `cycle_progress` WHEN NEW.`mutation_token` IS OLD.`mutation_token`
BEGIN
  UPDATE `cycle_progress` SET `mutation_token` = lower(hex(randomblob(16)))
  WHERE `profile_id` = NEW.`profile_id` AND `cycle_id` = NEW.`cycle_id` AND `season` = NEW.`season` AND `episode` = NEW.`episode`;
END;
--> statement-breakpoint
CREATE TRIGGER `cycle_playback_facts_stamp_insert`
AFTER INSERT ON `cycle_playback_facts`
BEGIN
  UPDATE `cycle_playback_facts` SET `mutation_token` = lower(hex(randomblob(16)))
  WHERE `profile_id` = NEW.`profile_id` AND `title_id` = NEW.`title_id` AND `season` = NEW.`season` AND `episode` = NEW.`episode`;
END;
--> statement-breakpoint
CREATE TRIGGER `cycle_playback_facts_stamp_update`
AFTER UPDATE ON `cycle_playback_facts` WHEN NEW.`mutation_token` IS OLD.`mutation_token`
BEGIN
  UPDATE `cycle_playback_facts` SET `mutation_token` = lower(hex(randomblob(16)))
  WHERE `profile_id` = NEW.`profile_id` AND `title_id` = NEW.`title_id` AND `season` = NEW.`season` AND `episode` = NEW.`episode`;
END;
--> statement-breakpoint
CREATE TRIGGER `mine_title_preferences_stamp_insert`
AFTER INSERT ON `mine_title_preferences`
BEGIN
  UPDATE `mine_title_preferences` SET `mutation_token` = lower(hex(randomblob(16)))
  WHERE `profile_id` = NEW.`profile_id` AND `title_id` = NEW.`title_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `mine_title_preferences_stamp_update`
AFTER UPDATE ON `mine_title_preferences` WHEN NEW.`mutation_token` IS OLD.`mutation_token`
BEGIN
  UPDATE `mine_title_preferences` SET `mutation_token` = lower(hex(randomblob(16)))
  WHERE `profile_id` = NEW.`profile_id` AND `title_id` = NEW.`title_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `mine_profile_preferences_stamp_insert`
AFTER INSERT ON `mine_profile_preferences`
BEGIN
  UPDATE `mine_profile_preferences` SET `mutation_token` = lower(hex(randomblob(16)))
  WHERE `profile_id` = NEW.`profile_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `mine_profile_preferences_stamp_update`
AFTER UPDATE ON `mine_profile_preferences` WHEN NEW.`mutation_token` IS OLD.`mutation_token`
BEGIN
  UPDATE `mine_profile_preferences` SET `mutation_token` = lower(hex(randomblob(16)))
  WHERE `profile_id` = NEW.`profile_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `cycle_progress_stamp_parent_insert`
AFTER INSERT ON `cycle_progress`
BEGIN
  UPDATE `rewatch_cycles` SET `updated_at` = `updated_at`
  WHERE `profile_id` = NEW.`profile_id` AND `id` = NEW.`cycle_id`;
END;

--> statement-breakpoint
CREATE TRIGGER `cycle_progress_stamp_parent_update`
AFTER UPDATE ON `cycle_progress` WHEN NEW.`mutation_token` IS OLD.`mutation_token`
BEGIN
  UPDATE `rewatch_cycles` SET `updated_at` = `updated_at`
  WHERE `profile_id` = NEW.`profile_id` AND `id` = NEW.`cycle_id`;
END;

--> statement-breakpoint
CREATE TRIGGER `cycle_progress_stamp_parent_delete`
AFTER DELETE ON `cycle_progress`
BEGIN
  UPDATE `rewatch_cycles` SET `updated_at` = `updated_at`
  WHERE `profile_id` = OLD.`profile_id` AND `id` = OLD.`cycle_id`;
END;
