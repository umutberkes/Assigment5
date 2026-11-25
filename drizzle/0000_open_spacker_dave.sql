-- Umut Berke Şenyayla, 2000002240
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`due_date` text,
	`status` text DEFAULT 'todo' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`completed_at` integer,
	`deleted_at` integer,
	`attachment` text,
	`attachment_type` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tasks_title_length" CHECK(length("tasks"."title") BETWEEN 1 AND 100),
	CONSTRAINT "tasks_status" CHECK("tasks"."status" IN ('todo', 'in-progress', 'done')),
	CONSTRAINT "tasks_priority" CHECK("tasks"."priority" IN ('low', 'medium', 'high'))
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_user_status_created` ON `tasks` (`user_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	CONSTRAINT "users_role" CHECK("users"."role" IN ('user', 'admin'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);