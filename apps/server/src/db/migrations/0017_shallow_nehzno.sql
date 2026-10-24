CREATE TABLE `profile_import_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`list` text NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`year` integer,
	`kind` text,
	`rating` integer,
	`at` integer,
	`suggestion` text,
	`position` integer NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `profile_imports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `profile_import_rows_profile_idx` ON `profile_import_rows` (`profile_id`,`import_id`,`position`);--> statement-breakpoint
CREATE TABLE `profile_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`sources` text NOT NULL,
	`conflicts` text NOT NULL,
	`summary` text NOT NULL,
	`undo` text,
	`applied_at` integer NOT NULL,
	`undone_at` integer,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `profile_imports_profile_idx` ON `profile_imports` (`profile_id`,`applied_at`);