CREATE TABLE `budget_periods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cost_center_id` integer NOT NULL,
	`fiscal_year` integer NOT NULL,
	`budget` real DEFAULT 0 NOT NULL,
	`spent` real DEFAULT 0 NOT NULL,
	`committed` real DEFAULT 0 NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
-- Backfill: each existing cost center's flat budget numbers become its FY2026 active period.
INSERT INTO budget_periods (cost_center_id, fiscal_year, budget, spent, committed, starts_at, ends_at, status, created_at)
SELECT id, 2026, annual_budget, spent, committed, '2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z', 'active', '2026-01-01T00:00:00.000Z'
FROM cost_centers;
--> statement-breakpoint
-- Added nullable (SQLite can't add a NOT NULL column without a default to a non-empty table);
-- the Drizzle schema still declares periodId as notNull() so every future insert supplies it.
ALTER TABLE `budget_commitments` ADD `period_id` integer;
--> statement-breakpoint
-- Backfill: every existing commitment belonged to "the one period" its cost center had.
UPDATE budget_commitments
SET period_id = (SELECT bp.id FROM budget_periods bp WHERE bp.cost_center_id = budget_commitments.cost_center_id);
--> statement-breakpoint
ALTER TABLE `cost_centers` DROP COLUMN `annual_budget`;
--> statement-breakpoint
ALTER TABLE `cost_centers` DROP COLUMN `spent`;
--> statement-breakpoint
ALTER TABLE `cost_centers` DROP COLUMN `committed`;
