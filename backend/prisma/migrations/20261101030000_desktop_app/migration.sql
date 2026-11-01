-- Where a Google OAuth callback returns to: the web app, or the desktop app through 9drive:// links.
ALTER TABLE `oauth_states` ADD COLUMN `client` VARCHAR(16) NOT NULL DEFAULT 'web';

-- Desktop uploads straight to S3 use a multipart upload the server opens and completes.
ALTER TABLE `upload_sessions`
  ADD COLUMN `provider` VARCHAR(32) NOT NULL DEFAULT 'google_drive',
  ADD COLUMN `s3_upload_id` TEXT NULL,
  ADD COLUMN `object_key` VARCHAR(1024) NULL;
