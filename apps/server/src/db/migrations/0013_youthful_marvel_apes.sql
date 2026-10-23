-- Настройка стала набором сервисов через запятую, а своя оценка видна всегда:
-- `own` — TMDB, `none` — пустой набор, `tmdb` и `imdb` уже наборы из одного.
-- Таблицу не пересоздаём: DROP TABLE profiles в транзакции миграций каскадом
-- удалил бы данные профилей. DEFAULT 'own' в DDL остаётся, значение ставит приложение
UPDATE `profiles` SET `poster_rating` = 'tmdb' WHERE `poster_rating` = 'own';
--> statement-breakpoint
UPDATE `profiles` SET `poster_rating` = '' WHERE `poster_rating` = 'none';
