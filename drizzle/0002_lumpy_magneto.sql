CREATE TABLE `balance_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`object` text,
	`amount` integer,
	`available_on` integer,
	`created` integer,
	`currency` text,
	`description` text,
	`exchange_rate` real,
	`fee` integer,
	`fee_details` text,
	`net` integer,
	`reporting_category` text,
	`source` text,
	`status` text,
	`type` text,
	`last_event_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_balance_transactions_source` ON `balance_transactions` (`source`);--> statement-breakpoint
CREATE INDEX `idx_balance_transactions_created` ON `balance_transactions` (`created`);