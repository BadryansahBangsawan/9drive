ALTER TABLE `users`
  ADD COLUMN `role` VARCHAR(32) NOT NULL DEFAULT 'user',
  ADD COLUMN `email_verified_at` DATETIME(3) NULL;

-- The earliest account becomes the instance admin.
UPDATE `users` SET `role` = 'admin' ORDER BY `created_at` ASC LIMIT 1;

-- Users who already signed in with Google under the same address have a verified email.
UPDATE `users` u
  JOIN `connected_accounts` ca ON ca.`user_id` = u.`id` AND ca.`provider` = 'google_drive' AND ca.`email` = u.`email`
  SET u.`email_verified_at` = CURRENT_TIMESTAMP(3);
