CREATE TABLE `backload_parent_progress` (
	`resource` text NOT NULL,
	`parent_id` text NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`cursor` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`resource`, `parent_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_backload_parent_progress_resource_status` ON `backload_parent_progress` (`resource`,`status`);--> statement-breakpoint
CREATE TABLE `checkout_session_line_items` (
	`id` text PRIMARY KEY NOT NULL,
	`object` text,
	`amount_discount` integer,
	`amount_subtotal` integer,
	`amount_tax` integer,
	`amount_total` integer,
	`checkout_session` text,
	`currency` text,
	`description` text,
	`discounts` text,
	`price` text,
	`quantity` integer,
	`taxes` text,
	`last_event_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_checkout_session_line_items_session` ON `checkout_session_line_items` (`checkout_session`);--> statement-breakpoint
CREATE TABLE `checkout_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`object` text,
	`adaptive_pricing` text,
	`after_expiration` text,
	`allow_promotion_codes` integer,
	`amount_subtotal` integer,
	`amount_total` integer,
	`automatic_tax` text,
	`billing_address_collection` text,
	`cancel_url` text,
	`client_reference_id` text,
	`client_secret` text,
	`collected_information` text,
	`consent` text,
	`consent_collection` text,
	`created` integer,
	`currency` text,
	`currency_conversion` text,
	`custom_fields` text,
	`custom_text` text,
	`customer` text,
	`customer_creation` text,
	`customer_details` text,
	`customer_email` text,
	`discounts` text,
	`expires_at` integer,
	`invoice` text,
	`invoice_creation` text,
	`livemode` integer,
	`locale` text,
	`metadata` text,
	`mode` text,
	`optional_items` text,
	`payment_intent` text,
	`payment_link` text,
	`payment_method_collection` text,
	`payment_method_configuration_details` text,
	`payment_method_options` text,
	`payment_method_types` text,
	`payment_status` text,
	`permissions` text,
	`phone_number_collection` text,
	`presentment_details` text,
	`recovered_from` text,
	`redirect_on_completion` text,
	`return_url` text,
	`saved_payment_method_options` text,
	`setup_intent` text,
	`shipping_address_collection` text,
	`shipping_cost` text,
	`shipping_options` text,
	`status` text,
	`submit_type` text,
	`subscription` text,
	`success_url` text,
	`tax_id_collection` text,
	`total_details` text,
	`ui_mode` text,
	`url` text,
	`wallet` text,
	`last_event_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_checkout_sessions_customer` ON `checkout_sessions` (`customer`);--> statement-breakpoint
CREATE INDEX `idx_checkout_sessions_payment_intent` ON `checkout_sessions` (`payment_intent`);--> statement-breakpoint
CREATE INDEX `idx_checkout_sessions_subscription` ON `checkout_sessions` (`subscription`);--> statement-breakpoint
CREATE INDEX `idx_checkout_sessions_status` ON `checkout_sessions` (`status`);--> statement-breakpoint
CREATE TABLE `coupons` (
	`id` text PRIMARY KEY NOT NULL,
	`object` text,
	`amount_off` integer,
	`applies_to` text,
	`created` integer,
	`currency` text,
	`currency_options` text,
	`duration` text,
	`duration_in_months` integer,
	`livemode` integer,
	`max_redemptions` integer,
	`metadata` text,
	`name` text,
	`percent_off` real,
	`redeem_by` integer,
	`times_redeemed` integer,
	`valid` integer,
	`deleted` integer,
	`last_event_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `credit_note_line_items` (
	`id` text PRIMARY KEY NOT NULL,
	`object` text,
	`amount` integer,
	`amount_excluding_tax` integer,
	`credit_note` text,
	`description` text,
	`discount_amount` integer,
	`discount_amounts` text,
	`invoice_line_item` text,
	`livemode` integer,
	`pretax_credit_amounts` text,
	`quantity` integer,
	`tax_amounts` text,
	`tax_rates` text,
	`taxes` text,
	`type` text,
	`unit_amount` integer,
	`unit_amount_decimal` text,
	`unit_amount_excluding_tax` text,
	`last_event_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_credit_note_line_items_credit_note` ON `credit_note_line_items` (`credit_note`);--> statement-breakpoint
CREATE TABLE `credit_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`object` text,
	`amount` integer,
	`amount_shipping` integer,
	`created` integer,
	`currency` text,
	`customer` text,
	`customer_balance_transaction` text,
	`discount_amount` integer,
	`discount_amounts` text,
	`effective_at` integer,
	`invoice` text,
	`livemode` integer,
	`memo` text,
	`metadata` text,
	`number` text,
	`out_of_band_amount` integer,
	`pdf` text,
	`pretax_credit_amounts` text,
	`reason` text,
	`refund` text,
	`refunds` text,
	`shipping_cost` text,
	`status` text,
	`subtotal` integer,
	`subtotal_excluding_tax` integer,
	`tax_amounts` text,
	`total` integer,
	`total_excluding_tax` integer,
	`total_taxes` text,
	`type` text,
	`voided_at` integer,
	`last_event_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_credit_notes_customer` ON `credit_notes` (`customer`);--> statement-breakpoint
CREATE INDEX `idx_credit_notes_invoice` ON `credit_notes` (`invoice`);--> statement-breakpoint
CREATE INDEX `idx_credit_notes_status` ON `credit_notes` (`status`);--> statement-breakpoint
CREATE TABLE `disputes` (
	`id` text PRIMARY KEY NOT NULL,
	`object` text,
	`amount` integer,
	`balance_transactions` text,
	`charge` text,
	`created` integer,
	`currency` text,
	`enhanced_evidence` text,
	`evidence` text,
	`evidence_details` text,
	`is_charge_refundable` integer,
	`livemode` integer,
	`metadata` text,
	`payment_intent` text,
	`payment_method_details` text,
	`reason` text,
	`status` text,
	`last_event_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_disputes_charge` ON `disputes` (`charge`);--> statement-breakpoint
CREATE INDEX `idx_disputes_payment_intent` ON `disputes` (`payment_intent`);--> statement-breakpoint
CREATE INDEX `idx_disputes_status` ON `disputes` (`status`);--> statement-breakpoint
CREATE TABLE `early_fraud_warnings` (
	`id` text PRIMARY KEY NOT NULL,
	`object` text,
	`actionable` integer,
	`charge` text,
	`created` integer,
	`fraud_type` text,
	`livemode` integer,
	`payment_intent` text,
	`last_event_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_early_fraud_warnings_charge` ON `early_fraud_warnings` (`charge`);--> statement-breakpoint
CREATE INDEX `idx_early_fraud_warnings_payment_intent` ON `early_fraud_warnings` (`payment_intent`);--> statement-breakpoint
CREATE TABLE `payment_methods` (
	`id` text PRIMARY KEY NOT NULL,
	`object` text,
	`allow_redisplay` text,
	`billing_details` text,
	`card` text,
	`card_present` text,
	`created` integer,
	`customer` text,
	`livemode` integer,
	`metadata` text,
	`type` text,
	`us_bank_account` text,
	`paypal` text,
	`link` text,
	`sepa_debit` text,
	`cashapp` text,
	`afterpay_clearpay` text,
	`klarna` text,
	`radar_options` text,
	`last_event_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_payment_methods_customer` ON `payment_methods` (`customer`);--> statement-breakpoint
CREATE INDEX `idx_payment_methods_type` ON `payment_methods` (`type`);--> statement-breakpoint
CREATE TABLE `payouts` (
	`id` text PRIMARY KEY NOT NULL,
	`object` text,
	`amount` integer,
	`application_fee_amount` integer,
	`arrival_date` integer,
	`automatic` integer,
	`balance_transaction` text,
	`created` integer,
	`currency` text,
	`description` text,
	`destination` text,
	`failure_balance_transaction` text,
	`failure_code` text,
	`failure_message` text,
	`livemode` integer,
	`metadata` text,
	`method` text,
	`original_payout` text,
	`reconciliation_status` text,
	`reversed_by` text,
	`source_type` text,
	`statement_descriptor` text,
	`status` text,
	`trace_id` text,
	`type` text,
	`last_event_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_payouts_status` ON `payouts` (`status`);--> statement-breakpoint
CREATE INDEX `idx_payouts_arrival_date` ON `payouts` (`arrival_date`);--> statement-breakpoint
CREATE TABLE `promotion_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`object` text,
	`active` integer,
	`code` text,
	`coupon` text,
	`created` integer,
	`customer` text,
	`expires_at` integer,
	`livemode` integer,
	`max_redemptions` integer,
	`metadata` text,
	`restrictions` text,
	`times_redeemed` integer,
	`last_event_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_promotion_codes_coupon` ON `promotion_codes` (`coupon`);--> statement-breakpoint
CREATE INDEX `idx_promotion_codes_customer` ON `promotion_codes` (`customer`);--> statement-breakpoint
CREATE INDEX `idx_promotion_codes_code` ON `promotion_codes` (`code`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`object` text,
	`billing_zip` text,
	`charge` text,
	`closed_reason` text,
	`created` integer,
	`ip_address` text,
	`ip_address_location` text,
	`livemode` integer,
	`open` integer,
	`opened_reason` text,
	`payment_intent` text,
	`reason` text,
	`session` text,
	`last_event_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_reviews_charge` ON `reviews` (`charge`);--> statement-breakpoint
CREATE INDEX `idx_reviews_payment_intent` ON `reviews` (`payment_intent`);--> statement-breakpoint
CREATE TABLE `setup_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`object` text,
	`application` text,
	`attach_to_self` integer,
	`automatic_payment_methods` text,
	`cancellation_reason` text,
	`client_secret` text,
	`created` integer,
	`customer` text,
	`description` text,
	`flow_directions` text,
	`last_setup_error` text,
	`latest_attempt` text,
	`livemode` integer,
	`mandate` text,
	`metadata` text,
	`next_action` text,
	`on_behalf_of` text,
	`payment_method` text,
	`payment_method_configuration_details` text,
	`payment_method_options` text,
	`payment_method_types` text,
	`single_use_mandate` text,
	`status` text,
	`usage` text,
	`last_event_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_setup_intents_customer` ON `setup_intents` (`customer`);--> statement-breakpoint
CREATE TABLE `subscription_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`object` text,
	`application` text,
	`canceled_at` integer,
	`completed_at` integer,
	`created` integer,
	`current_phase` text,
	`customer` text,
	`default_settings` text,
	`end_behavior` text,
	`livemode` integer,
	`metadata` text,
	`phases` text,
	`released_at` integer,
	`released_subscription` text,
	`status` text,
	`subscription` text,
	`test_clock` text,
	`last_event_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_subscription_schedules_customer` ON `subscription_schedules` (`customer`);--> statement-breakpoint
CREATE INDEX `idx_subscription_schedules_subscription` ON `subscription_schedules` (`subscription`);--> statement-breakpoint
CREATE INDEX `idx_subscription_schedules_status` ON `subscription_schedules` (`status`);--> statement-breakpoint
CREATE TABLE `tax_ids` (
	`id` text PRIMARY KEY NOT NULL,
	`object` text,
	`country` text,
	`created` integer,
	`customer` text,
	`livemode` integer,
	`type` text,
	`value` text,
	`verification` text,
	`owner` text,
	`deleted` integer,
	`last_event_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tax_ids_customer` ON `tax_ids` (`customer`);