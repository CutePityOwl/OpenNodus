CREATE TABLE `graph_state` (
	`graph_session_id` text PRIMARY KEY REFERENCES `session`(`id`) ON DELETE cascade,
	`selected_node_id` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `graph_node` (
	`id` text PRIMARY KEY,
	`graph_session_id` text NOT NULL REFERENCES `session`(`id`) ON DELETE cascade,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`provider_id` text,
	`model_id` text,
	`model` text,
	`instructions` text,
	`same_chat` integer NOT NULL,
	`can_spawn_agents` integer NOT NULL,
	`current_chat_session_id` text,
	`position` text NOT NULL,
	`size` text,
	`permission` text,
	`tool_policy` text,
	`mcp_policy` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `graph_node_session_idx` ON `graph_node` (`graph_session_id`);
--> statement-breakpoint
CREATE INDEX `graph_node_session_type_idx` ON `graph_node` (`graph_session_id`,`type`);
--> statement-breakpoint
CREATE TABLE `graph_edge` (
	`id` text PRIMARY KEY,
	`graph_session_id` text NOT NULL REFERENCES `session`(`id`) ON DELETE cascade,
	`source_node_id` text NOT NULL REFERENCES `graph_node`(`id`) ON DELETE cascade,
	`target_node_id` text NOT NULL REFERENCES `graph_node`(`id`) ON DELETE cascade,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `graph_edge_session_idx` ON `graph_edge` (`graph_session_id`);
--> statement-breakpoint
CREATE INDEX `graph_edge_source_idx` ON `graph_edge` (`source_node_id`);
--> statement-breakpoint
CREATE INDEX `graph_edge_target_idx` ON `graph_edge` (`target_node_id`);
