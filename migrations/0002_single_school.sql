ALTER TABLE `schools` DROP COLUMN `join_code`;

--> statement-breakpoint

-- 단일 학교 운영: 김천고등학교( id = 1 )를 기준 학교로 둔다.
-- 기존에 만들어진 다른 학교와 그 소속 사용자 데이터는 정리한다.
DELETE FROM `rank_entries`
WHERE `user_id` IN (SELECT `id` FROM `users` WHERE `school_id` <> 1);

--> statement-breakpoint

DELETE FROM `users` WHERE `school_id` <> 1;

--> statement-breakpoint

DELETE FROM `schools` WHERE `id` <> 1;

--> statement-breakpoint

INSERT INTO `schools` (`id`, `name`, `created_at`)
VALUES (1, '김천고등학교', unixepoch() * 1000)
ON CONFLICT (`id`) DO UPDATE SET `name` = excluded.`name`;