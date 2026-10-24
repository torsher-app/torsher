CREATE TABLE `notification_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`language` text NOT NULL,
	`panel_url` text,
	`config` text NOT NULL,
	`events` text NOT NULL,
	`include_warnings` integer DEFAULT false NOT NULL,
	`notify_resolved` integer DEFAULT false NOT NULL,
	`last_sent_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`problem` text,
	`severity` text NOT NULL,
	`section` text,
	`params` text NOT NULL,
	`created_at` integer NOT NULL,
	`read_at` integer,
	`resolved_at` integer,
	`resolution_sent_at` integer
);
--> statement-breakpoint
CREATE INDEX `notifications_created_at_idx` ON `notifications` (`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_problem_idx` ON `notifications` (`problem`,`resolved_at`);--> statement-breakpoint
CREATE TABLE `server_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version` text NOT NULL,
	`commit` text,
	`started_at` integer NOT NULL
);
