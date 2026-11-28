CREATE TABLE `simkl_connections` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`generation` text NOT NULL,
	`account_fingerprint` text NOT NULL,
	`account` text NOT NULL,
	`client_id` text NOT NULL,
	`grant` text NOT NULL,
	`expires_at` integer NOT NULL,
	`scope` text NOT NULL,
	`pull` integer DEFAULT false NOT NULL,
	`push` integer DEFAULT false NOT NULL,
	`reauthorize` integer DEFAULT false NOT NULL,
	`cursor` text,
	`last_sync_at` integer,
	`last_pull_at` integer,
	`blocked_until` integer DEFAULT 0 NOT NULL,
	`sync_error` integer DEFAULT false NOT NULL,
	`skipped` integer DEFAULT 0 NOT NULL,
	`overflow` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `simkl_connections_account_fingerprint_unique` ON `simkl_connections` (`account_fingerprint`);--> statement-breakpoint
CREATE TABLE `simkl_outbox` (
	`profile_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`generation` text NOT NULL,
	`diary_id` text NOT NULL,
	`title_id` text NOT NULL,
	`season` integer NOT NULL,
	`episode` integer NOT NULL,
	`watched_at` integer NOT NULL,
	`simkl_id` integer,
	`state` text DEFAULT 'queued' NOT NULL,
	`dispatched` integer DEFAULT false NOT NULL,
	`retries` integer DEFAULT 0 NOT NULL,
	`next_try_at` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `attempt_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `simkl_connections`(`profile_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `simkl_outbox_schedule_idx` ON `simkl_outbox` (`state`,`next_try_at`);--> statement-breakpoint
CREATE INDEX `simkl_outbox_media_idx` ON `simkl_outbox` (`profile_id`,`simkl_id`,`season`,`episode`);--> statement-breakpoint
CREATE TABLE `simkl_receipts` (
	`profile_id` text NOT NULL,
	`account_fingerprint` text NOT NULL,
	`remote_key` text NOT NULL,
	`diary_id` text NOT NULL,
	`title_id` text NOT NULL,
	`watched_at` integer,
	`kind` text NOT NULL,
	PRIMARY KEY(`profile_id`, `account_fingerprint`, `remote_key`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
