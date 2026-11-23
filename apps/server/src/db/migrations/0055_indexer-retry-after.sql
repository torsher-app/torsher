ALTER TABLE `indexers` ADD `retry_after_until` integer;--> statement-breakpoint
UPDATE `indexers` SET `retry_after_until` = `backoff_until`
WHERE `retry_after_until` IS NULL AND `backoff_until` IS NOT NULL;
