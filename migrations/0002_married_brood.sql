CREATE TABLE `goods_receipt_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`receipt_id` integer NOT NULL,
	`request_line_item_id` integer NOT NULL,
	`quantity_received` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `goods_receipts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`received_by_id` integer,
	`note` text DEFAULT '' NOT NULL,
	`received_at` text NOT NULL
);
