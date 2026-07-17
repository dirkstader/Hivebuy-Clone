CREATE TABLE `contracts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contract_number` text NOT NULL,
	`title` text NOT NULL,
	`supplier_id` integer NOT NULL,
	`cost_center_id` integer,
	`value` real DEFAULT 0 NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`notice_period_days` integer DEFAULT 90 NOT NULL,
	`auto_renew` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`cancelled_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contracts_contract_number_unique` ON `contracts` (`contract_number`);