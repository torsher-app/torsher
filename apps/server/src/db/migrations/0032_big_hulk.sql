ALTER TABLE `title_progress` ADD `watched_at` integer;--> statement-breakpoint
-- Отметка переносится по прежнему правилу isWatched (services/torrents/playback.ts)
UPDATE `title_progress` SET `watched_at` = `updated_at`
WHERE `watched_at` IS NULL
  AND `duration` > 0
  AND `position` / `duration` >= 0.05
  AND (`position` / `duration` > 0.9 OR `position` >= `duration` - 1 OR `duration` < 300);--> statement-breakpoint
-- Отметка с карточки хранилась позицией 1 из 1: отметка остаётся, позиция — нет
UPDATE `title_progress` SET `position` = 0, `duration` = NULL
WHERE `position` = 1 AND `duration` = 1 AND `watched_at` IS NOT NULL;
