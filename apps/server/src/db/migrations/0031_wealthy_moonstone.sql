ALTER TABLE `users` RENAME COLUMN "name" TO "username";--> statement-breakpoint
DROP INDEX `users_email_unique`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `email`;