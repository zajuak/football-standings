CREATE TABLE `submissions` (
	`revision` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`submission_id` text NOT NULL,
	`base_revision` integer NOT NULL,
	`action` text NOT NULL,
	`state` text NOT NULL,
	`applied` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submission_id_unique` ON `submissions` (`submission_id`);