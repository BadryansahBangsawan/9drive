-- Google Drive changes feed position per account, and when the last full import ran.
ALTER TABLE `connected_accounts`
  ADD COLUMN `drive_changes_token` VARCHAR(255) NULL,
  ADD COLUMN `drive_full_sync_at` DATETIME(3) NULL;

-- Rows Google sync deleted because they left Drive (not the user) come back when they reappear.
ALTER TABLE `files` ADD COLUMN `deleted_by_sync` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `folders` ADD COLUMN `deleted_by_sync` BOOLEAN NOT NULL DEFAULT false;
