CREATE TABLE `events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`target_id` text,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_events_room_seq` ON `events` (`room_id`,`seq`);--> statement-breakpoint
CREATE INDEX `idx_events_created` ON `events` (`created_at`);--> statement-breakpoint
CREATE TABLE `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`nickname` text NOT NULL,
	`token_hash` text NOT NULL,
	`seat` integer NOT NULL,
	`joined_at` integer NOT NULL,
	`last_seen` integer NOT NULL,
	`lit_at` integer,
	`mic_on` integer DEFAULT 0 NOT NULL,
	`last_message_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_participants_room_seat` ON `participants` (`room_id`,`seat`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rooms_expires` ON `rooms` (`expires_at`);