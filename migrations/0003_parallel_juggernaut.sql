CREATE TABLE `budget_commitments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cost_center_id` integer NOT NULL,
	`request_id` integer NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'reserved' NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text
);
--> statement-breakpoint
ALTER TABLE `cost_centers` ADD `committed` real DEFAULT 0 NOT NULL;