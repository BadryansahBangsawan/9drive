-- Folders imported from a connected Google Drive (whole My Drive) vs created in 9drive.
ALTER TABLE `folders` ADD COLUMN `source` VARCHAR(16) NOT NULL DEFAULT 'app';
CREATE INDEX `folders_connected_account_id_provider_folder_id_idx` ON `folders`(`connected_account_id`, `provider_folder_id`);
