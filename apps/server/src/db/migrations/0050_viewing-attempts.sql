CREATE TABLE `viewing_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`title_id` text NOT NULL,
	`season` integer NOT NULL,
	`episode` integer NOT NULL,
	`cycle_key` text NOT NULL,
	`generation` integer NOT NULL,
	`state` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `viewing_attempts_generation_idx` ON `viewing_attempts` (`profile_id`,`title_id`,`season`,`episode`,`cycle_key`,`generation`);--> statement-breakpoint
CREATE TABLE `viewing_bindings` (
	`session_id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`subject` text NOT NULL,
	`client_id` text NOT NULL,
	`player_id` text NOT NULL,
	`source_revision` text NOT NULL,
	`line` integer DEFAULT 0 NOT NULL,
	`baseline` real,
	`advanced` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `viewing_attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `viewing_bindings_attempt_idx` ON `viewing_bindings` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `viewing_start_receipts` (
	`profile_id` text NOT NULL,
	`request_id` text NOT NULL,
	`command` text NOT NULL,
	`attempt_id` text NOT NULL,
	PRIMARY KEY(`profile_id`, `request_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `viewing_attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
