CREATE TABLE `external_list_decisions` (
	`profile_id` text NOT NULL,
	`title_id` text NOT NULL,
	`decision` text NOT NULL,
	PRIMARY KEY(`profile_id`, `title_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `external_list_decisions_profile_kind_idx` ON `external_list_decisions` (`profile_id`,`decision`,`title_id`);--> statement-breakpoint
CREATE TABLE `external_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` integer NOT NULL,
	`name` text NOT NULL,
	`profile_id` text NOT NULL,
	`media` text NOT NULL,
	`interval_hours` integer NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`check_offset` integer DEFAULT 0 NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` integer,
	`last_read_at` integer,
	`next_run_at` integer,
	`last_result` text,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_lists_source_profile_idx` ON `external_lists` (`source_id`,`profile_id`);--> statement-breakpoint
CREATE INDEX `external_lists_due_idx` ON `external_lists` (`paused`,`next_run_at`);--> statement-breakpoint
CREATE INDEX `external_lists_profile_idx` ON `external_lists` (`profile_id`);