-- Signing in becomes phone number and password (owner's decision of
-- 9 November 2026). The invitation link, the PIN and the lock after 5 wrong
-- PINs are gone, and so are the columns that held them: the PIN hash (a
-- secret no longer used), the wrong-PIN count and the lock date. No record is
-- removed. Every account starts with no password, and cannot sign in until an
-- administrator gives it one (in Usuarios, or `user:password` on the server).
-- Old invitation and remembered-phone rows stay in access_tokens as history.
ALTER TABLE `users` ADD `password_hash` text;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `pin_hash`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `failed_pin_count`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `locked_at`;