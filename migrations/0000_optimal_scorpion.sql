CREATE TABLE `activity_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`actor_id` integer,
	`action` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `catalog_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`supplier_id` integer NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`unit` text DEFAULT 'Stk.' NOT NULL,
	`unit_price` real DEFAULT 0 NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`brand` text DEFAULT '' NOT NULL,
	`ean` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cost_centers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`owner` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`annual_budget` real DEFAULT 0 NOT NULL,
	`spent` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cost_centers_code_unique` ON `cost_centers` (`code`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_number` text NOT NULL,
	`order_id` integer NOT NULL,
	`supplier_id` integer NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending_review' NOT NULL,
	`received_at` text NOT NULL,
	`due_date` text,
	`match_note` text DEFAULT '' NOT NULL,
	`paid_at` text
);
--> statement-breakpoint
CREATE TABLE `punchout_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` integer,
	`user_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`cart_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`returned_at` text
);
--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_number` text NOT NULL,
	`request_id` integer NOT NULL,
	`supplier_id` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`total_amount` real DEFAULT 0 NOT NULL,
	`ordered_at` text NOT NULL,
	`expected_delivery` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_orders_order_number_unique` ON `purchase_orders` (`order_number`);--> statement-breakpoint
CREATE TABLE `purchase_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_number` text NOT NULL,
	`requester_id` integer NOT NULL,
	`cost_center_id` integer NOT NULL,
	`supplier_id` integer,
	`title` text NOT NULL,
	`justification` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`total_amount` real DEFAULT 0 NOT NULL,
	`approver_id` integer,
	`approver_comment` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`decided_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_requests_request_number_unique` ON `purchase_requests` (`request_number`);--> statement-breakpoint
CREATE TABLE `request_line_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` integer NOT NULL,
	`catalog_item_id` integer,
	`description` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_price` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`contact_name` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`rating` integer DEFAULT 4 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password` text NOT NULL,
	`role` text DEFAULT 'requester' NOT NULL,
	`department` text DEFAULT '' NOT NULL,
	`cost_center_id` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);