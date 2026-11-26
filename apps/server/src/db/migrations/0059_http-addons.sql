CREATE TABLE `http_addons` (
	`id` text PRIMARY KEY NOT NULL,
	`origin` text NOT NULL,
	`encrypted_url` text NOT NULL,
	`manifest` text NOT NULL,
	`selections` text NOT NULL,
	`lan_addresses` text NOT NULL,
	`enabled` integer NOT NULL,
	`revision` text NOT NULL,
	`created_at` integer NOT NULL,
	`checked_at` integer NOT NULL,
	`check_error` text
);
