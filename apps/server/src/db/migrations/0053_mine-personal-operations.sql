CREATE TABLE `manual_diary_requests` (
	`profile_id` text NOT NULL,
	`request_id` text NOT NULL,
	`command` text NOT NULL,
	PRIMARY KEY(`profile_id`, `request_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `cycle_progress` ADD `completed_at` integer;--> statement-breakpoint
ALTER TABLE `mine_profile_preferences` ADD `start_collection_id` text REFERENCES collections(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `rewatch_cycles` ADD `create_request_id` text;--> statement-breakpoint
ALTER TABLE `rewatch_cycles` ADD `lifecycle_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `rewatch_cycles_create_request_idx` ON `rewatch_cycles` (`profile_id`,`create_request_id`) WHERE "rewatch_cycles"."create_request_id" is not null;--> statement-breakpoint
ALTER TABLE `viewing_bindings` ADD `cycle_lifecycle_revision` integer;
--> statement-breakpoint
-- A local lifecycle epoch revokes every binding across pause/resume/end,
-- including state changes made by native import and conditional undo.
CREATE TRIGGER `rewatch_cycles_lifecycle_insert`
AFTER INSERT ON `rewatch_cycles`
BEGIN
  UPDATE `rewatch_cycles` SET `lifecycle_revision` = 1 + abs(random() % 4503599627370496)
  WHERE `profile_id` = NEW.`profile_id` AND `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `rewatch_cycles_lifecycle_update`
AFTER UPDATE OF `state` ON `rewatch_cycles` WHEN NEW.`state` IS NOT OLD.`state`
BEGIN
  UPDATE `rewatch_cycles` SET `lifecycle_revision` = OLD.`lifecycle_revision` + 1
  WHERE `profile_id` = NEW.`profile_id` AND `id` = NEW.`id`;
END;
