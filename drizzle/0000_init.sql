CREATE TABLE `job_listings` (
	`id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`source_job_id` text NOT NULL,
	`source_url` text NOT NULL,
	`normalized_source_url` text NOT NULL,
	`apply_url` text,
	`title` text NOT NULL,
	`company_name` text NOT NULL,
	`location` text,
	`city` text,
	`region` text,
	`country` text DEFAULT 'Australia' NOT NULL,
	`posted_at` integer,
	`expires_at` integer,
	`employment_type` text,
	`workplace_type` text,
	`seniority` text,
	`description_text` text,
	`description_html` text,
	`raw_item` text NOT NULL,
	`content_hash` text NOT NULL,
	`first_seen_run_id` text,
	`last_seen_run_id` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`last_changed_at` integer,
	`processing_status` text DEFAULT 'unprocessed' NOT NULL,
	`processing_error` text,
	`processed_at` integer,
	`fit_score` integer,
	`fit_label` text,
	`fit_rationale` text,
	`fit_strengths` text DEFAULT '[]' NOT NULL,
	`fit_gaps` text DEFAULT '[]' NOT NULL,
	`assessed_at` integer,
	`emailed_at` integer,
	`email_subject` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`first_seen_run_id`) REFERENCES `job_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`last_seen_run_id`) REFERENCES `job_runs`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE UNIQUE INDEX `job_listings_source_job_unique` ON `job_listings` (`source_key`,`source_job_id`);
CREATE UNIQUE INDEX `job_listings_source_url_unique` ON `job_listings` (`source_key`,`normalized_source_url`);
CREATE INDEX `job_listings_processing_idx` ON `job_listings` (`processing_status`);
CREATE INDEX `job_listings_source_last_seen_idx` ON `job_listings` (`source_key`,`last_seen_at`);
CREATE INDEX `job_listings_company_idx` ON `job_listings` (`company_name`);
CREATE TABLE `job_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`purpose` text NOT NULL,
	`location` text,
	`query_payload` text NOT NULL,
	`raw_artifact_path` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text DEFAULT 'running' NOT NULL,
	`raw_count` integer,
	`filtered_count` integer,
	`new_count` integer,
	`changed_count` integer,
	`unchanged_count` integer,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);

CREATE INDEX `job_runs_source_started_idx` ON `job_runs` (`source_key`,`started_at`);