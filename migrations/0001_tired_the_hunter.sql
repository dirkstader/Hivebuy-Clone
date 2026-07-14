CREATE TABLE `approval_steps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` integer NOT NULL,
	`step_order` integer NOT NULL,
	`approver_role` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by_id` integer,
	`comment` text DEFAULT '' NOT NULL,
	`decided_at` text
);
