CREATE TABLE `approval_delegations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`delegator_id` integer NOT NULL,
	`delegate_id` integer NOT NULL,
	`starts_at` text,
	`ends_at` text,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `approval_delegations_delegator_id_unique` ON `approval_delegations` (`delegator_id`);--> statement-breakpoint
ALTER TABLE `approval_steps` ADD `decided_on_behalf_of_id` integer;