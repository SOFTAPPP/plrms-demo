CREATE TABLE `alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`last_ts` integer NOT NULL,
	`machine_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`severity` text NOT NULL,
	`message` text NOT NULL,
	`value` real,
	`threshold` real,
	`status` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`camera` text,
	`operator_name` text,
	`ack_by` text,
	`ack_at` integer,
	`resolved_by` text,
	`resolved_at` integer,
	`note` text
);
--> statement-breakpoint
CREATE INDEX `alerts_status` ON `alerts` (`status`);--> statement-breakpoint
CREATE INDEX `alerts_ts` ON `alerts` (`ts`);--> statement-breakpoint
CREATE INDEX `alerts_machine` ON `alerts` (`machine_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`user_name` text NOT NULL,
	`action` text NOT NULL,
	`detail` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_ts` ON `audit_log` (`ts`);--> statement-breakpoint
CREATE TABLE `cameras` (
	`id` text PRIMARY KEY NOT NULL,
	`machine_id` text NOT NULL,
	`position` text NOT NULL,
	`label` text NOT NULL,
	`resolution` text NOT NULL,
	`fps` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`recording` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cameras_machine` ON `cameras` (`machine_id`);--> statement-breakpoint
CREATE TABLE `downtime` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`machine_id` text NOT NULL,
	`start` integer NOT NULL,
	`end` integer,
	`category` text NOT NULL,
	`reason` text NOT NULL,
	`notes` text,
	`source` text NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `downtime_start` ON `downtime` (`start`);--> statement-breakpoint
CREATE TABLE `fuel_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`machine_id` text NOT NULL,
	`type` text NOT NULL,
	`litres` real NOT NULL,
	`level_before` real NOT NULL,
	`level_after` real NOT NULL,
	`location` text NOT NULL,
	`note` text,
	`recorded_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `fuel_ts` ON `fuel_events` (`ts`);--> statement-breakpoint
CREATE TABLE `machine_shift_stats` (
	`mine_day` text NOT NULL,
	`shift` text NOT NULL,
	`machine_id` text NOT NULL,
	`operating_sec` real DEFAULT 0 NOT NULL,
	`idle_sec` real DEFAULT 0 NOT NULL,
	`down_sec` real DEFAULT 0 NOT NULL,
	`maint_sec` real DEFAULT 0 NOT NULL,
	`fuel_l` real DEFAULT 0 NOT NULL,
	`distance_km` real DEFAULT 0 NOT NULL,
	`loads` integer DEFAULT 0 NOT NULL,
	`tonnes` real DEFAULT 0 NOT NULL,
	`passes` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`mine_day`, `shift`, `machine_id`)
);
--> statement-breakpoint
CREATE TABLE `machines` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`make` text NOT NULL,
	`model` text NOT NULL,
	`year` integer NOT NULL,
	`serial` text NOT NULL,
	`capacity` real NOT NULL,
	`fuel_capacity` real NOT NULL,
	`home_node` text NOT NULL,
	`route_id` text,
	`loader_id` text,
	`in_service` integer DEFAULT true NOT NULL,
	`fuel_l` real NOT NULL,
	`engine_hours` real NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `maintenance` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`machine_id` text NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`priority` text NOT NULL,
	`due_at` integer NOT NULL,
	`duration_h` real NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`technician` text,
	`cost` real,
	`notes` text,
	`source` text NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `maint_due` ON `maintenance` (`due_at`);--> statement-breakpoint
CREATE TABLE `operators` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`employee_no` text NOT NULL,
	`shift` text NOT NULL,
	`phone` text NOT NULL,
	`licence` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`experience_years` integer NOT NULL,
	`safety_score` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operators_employee_no_unique` ON `operators` (`employee_no`);--> statement-breakpoint
CREATE TABLE `production_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`mine_day` text NOT NULL,
	`shift` text NOT NULL,
	`truck_id` text NOT NULL,
	`loader_id` text NOT NULL,
	`route_id` text NOT NULL,
	`operator_id` integer,
	`material` text NOT NULL,
	`tonnes` real NOT NULL,
	`passes` integer NOT NULL,
	`load_ts` integer NOT NULL,
	`cycle_sec` real NOT NULL,
	`queue_sec` real NOT NULL,
	`spot_sec` real NOT NULL,
	`load_sec` real NOT NULL,
	`haul_sec` real NOT NULL,
	`dump_sec` real NOT NULL,
	`return_sec` real NOT NULL,
	`distance_km` real NOT NULL
);
--> statement-breakpoint
CREATE INDEX `prod_ts` ON `production_events` (`ts`);--> statement-breakpoint
CREATE INDEX `prod_day` ON `production_events` (`mine_day`,`shift`);--> statement-breakpoint
CREATE INDEX `prod_truck` ON `production_events` (`truck_id`,`ts`);--> statement-breakpoint
CREATE INDEX `prod_loader` ON `production_events` (`loader_id`,`ts`);--> statement-breakpoint
CREATE TABLE `recordings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`machine_id` text NOT NULL,
	`camera` text NOT NULL,
	`start_ts` integer NOT NULL,
	`end_ts` integer NOT NULL,
	`kind` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`client_key` text NOT NULL,
	`user_name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `roster` (
	`machine_id` text NOT NULL,
	`shift` text NOT NULL,
	`operator_id` integer,
	PRIMARY KEY(`machine_id`, `shift`)
);
--> statement-breakpoint
CREATE TABLE `routes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`loader_node` text NOT NULL,
	`dest_node` text NOT NULL,
	`material` text NOT NULL,
	`distance_km` real NOT NULL,
	`target_cycle_min` real NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sensor_defs` (
	`key` text PRIMARY KEY NOT NULL,
	`def` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`created_at` integer NOT NULL,
	`machine_id` text NOT NULL,
	`camera` text NOT NULL,
	`image` text NOT NULL,
	`user_name` text NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `telemetry` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`machine_id` text NOT NULL,
	`ts` integer NOT NULL,
	`st` text NOT NULL,
	`act` text,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`h` real NOT NULL,
	`spd` real NOT NULL,
	`pay` real,
	`fuel` real,
	`e_temp` real,
	`rpm` real,
	`e_load` real,
	`fuel_rate` real,
	`brk` real,
	`tyre_p` real,
	`tyre_t` real,
	`hyd` real,
	`vib` real,
	`bat` real,
	`swing` real,
	`boom` real,
	`stick` real,
	`arm` real,
	`b_fill` real,
	`water` real,
	`depth` real
);
--> statement-breakpoint
CREATE INDEX `telemetry_machine_ts` ON `telemetry` (`machine_id`,`ts`);--> statement-breakpoint
CREATE INDEX `telemetry_ts` ON `telemetry` (`ts`);--> statement-breakpoint
CREATE TABLE `user_prefs` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`layout` text,
	`theme` text
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`last_login_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);