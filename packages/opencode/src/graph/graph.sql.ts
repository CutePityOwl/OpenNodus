import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Permission } from "@/permission"
import { ModelID, ProviderID } from "@/provider/schema"
import { SessionTable } from "@/session/session.sql"
import { SessionID } from "@/session/schema"
import { Timestamps } from "@/storage/schema.sql"
import type { EdgeID, McpPolicy, NodeID, NodeType, Position, Size, ToolPolicy } from "./schema"

export const GraphStateTable = sqliteTable("graph_state", {
  graph_session_id: text()
    .$type<SessionID>()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  selected_node_id: text().$type<NodeID>(),
  ...Timestamps,
})

export const GraphNodeTable = sqliteTable(
  "graph_node",
  {
    id: text().$type<NodeID>().primaryKey(),
    graph_session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    type: text().$type<NodeType>().notNull(),
    name: text().notNull(),
    provider_id: text().$type<ProviderID>(),
    model_id: text().$type<ModelID>(),
    model: text({ mode: "json" }).$type<{ id: ModelID; providerID: ProviderID; variant?: string }>(),
    instructions: text(),
    same_chat: integer({ mode: "boolean" }).notNull(),
    can_spawn_agents: integer({ mode: "boolean" }).notNull(),
    current_chat_session_id: text().$type<SessionID>(),
    position: text({ mode: "json" }).notNull().$type<Position>(),
    size: text({ mode: "json" }).$type<Size>(),
    permission: text({ mode: "json" }).$type<Permission.Ruleset>(),
    tool_policy: text({ mode: "json" }).$type<ToolPolicy>(),
    mcp_policy: text({ mode: "json" }).$type<McpPolicy>(),
    ...Timestamps,
  },
  (table) => [
    index("graph_node_session_idx").on(table.graph_session_id),
    index("graph_node_session_type_idx").on(table.graph_session_id, table.type),
  ],
)

export const GraphEdgeTable = sqliteTable(
  "graph_edge",
  {
    id: text().$type<EdgeID>().primaryKey(),
    graph_session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    source_node_id: text()
      .$type<NodeID>()
      .notNull()
      .references(() => GraphNodeTable.id, { onDelete: "cascade" }),
    target_node_id: text()
      .$type<NodeID>()
      .notNull()
      .references(() => GraphNodeTable.id, { onDelete: "cascade" }),
    ...Timestamps,
  },
  (table) => [
    index("graph_edge_session_idx").on(table.graph_session_id),
    index("graph_edge_source_idx").on(table.source_node_id),
    index("graph_edge_target_idx").on(table.target_node_id),
  ],
)
