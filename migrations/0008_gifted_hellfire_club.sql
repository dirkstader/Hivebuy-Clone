ALTER TABLE `punchout_sessions` ADD `buyer_cookie` text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `punchout_sessions_buyer_cookie_unique` ON `punchout_sessions` (`buyer_cookie`);