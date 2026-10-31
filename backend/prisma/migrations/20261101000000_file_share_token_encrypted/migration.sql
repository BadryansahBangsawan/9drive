-- Share tokens are kept encrypted (app-side AES-GCM) instead of in plaintext.
-- Existing plaintext `token` values are encrypted and cleared by the backend at startup
-- (encryptLegacyShareTokens), since the key is not available to SQL.
ALTER TABLE `file_shares` ADD COLUMN `token_encrypted` TEXT NULL;
