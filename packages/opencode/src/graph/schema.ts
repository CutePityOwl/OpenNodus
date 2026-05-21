import { ModelID, ProviderID } from "@/provider/schema"
import { Permission } from "@/permission"
import { SessionID } from "@/session/schema"
import { optionalOmitUndefined, withStatics } from "@opencode-ai/core/schema"
import { Schema, Types } from "effect"
import { randomUUID } from "crypto"

export const NodeID = Schema.String.check(Schema.isStartsWith("gnode")).pipe(
  Schema.brand("GraphNodeID"),
  withStatics((schema) => ({
    ascending: (id?: string) => schema.make(id ?? `gnode_${randomUUID()}`),
  })),
)
export type NodeID = Schema.Schema.Type<typeof NodeID>

export const EdgeID = Schema.String.check(Schema.isStartsWith("gedge")).pipe(
  Schema.brand("GraphEdgeID"),
  withStatics((schema) => ({
    ascending: (id?: string) => schema.make(id ?? `gedge_${randomUUID()}`),
  })),
)
export type EdgeID = Schema.Schema.Type<typeof EdgeID>

export const NodeType = Schema.Literals(["orchestrator", "agent"])
export type NodeType = Schema.Schema.Type<typeof NodeType>

export const Position = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
})
export type Position = Schema.Schema.Type<typeof Position>

export const Size = Schema.Struct({
  width: Schema.Number,
  height: Schema.Number,
})
export type Size = Schema.Schema.Type<typeof Size>

export const Model = Schema.Struct({
  id: ModelID,
  providerID: ProviderID,
  variant: optionalOmitUndefined(Schema.String),
})
export type Model = Schema.Schema.Type<typeof Model>

export const ToolPolicy = Schema.Record(Schema.String, Schema.Any)
export type ToolPolicy = Schema.Schema.Type<typeof ToolPolicy>

export const McpPolicy = Schema.Record(Schema.String, Schema.Any)
export type McpPolicy = Schema.Schema.Type<typeof McpPolicy>

export const Node = Schema.Struct({
  id: NodeID,
  graphSessionID: SessionID,
  type: NodeType,
  name: Schema.String,
  providerID: optionalOmitUndefined(ProviderID),
  modelID: optionalOmitUndefined(ModelID),
  model: optionalOmitUndefined(Model),
  instructions: optionalOmitUndefined(Schema.String),
  sameChat: Schema.Boolean,
  canSpawnAgents: Schema.Boolean,
  currentChatSessionID: optionalOmitUndefined(SessionID),
  position: Position,
  size: optionalOmitUndefined(Size),
  permission: optionalOmitUndefined(Permission.Ruleset),
  toolPolicy: optionalOmitUndefined(ToolPolicy),
  mcpPolicy: optionalOmitUndefined(McpPolicy),
  time: Schema.Struct({
    created: Schema.Number,
    updated: Schema.Number,
  }),
}).annotate({ identifier: "GraphNode" })
export type Node = Types.DeepMutable<Schema.Schema.Type<typeof Node>>

export const Edge = Schema.Struct({
  id: EdgeID,
  graphSessionID: SessionID,
  sourceNodeID: NodeID,
  targetNodeID: NodeID,
  time: Schema.Struct({
    created: Schema.Number,
    updated: Schema.Number,
  }),
}).annotate({ identifier: "GraphEdge" })
export type Edge = Types.DeepMutable<Schema.Schema.Type<typeof Edge>>

export const State = Schema.Struct({
  graphSessionID: SessionID,
  selectedNodeID: optionalOmitUndefined(NodeID),
  time: Schema.Struct({
    created: Schema.Number,
    updated: Schema.Number,
  }),
}).annotate({ identifier: "GraphState" })
export type State = Types.DeepMutable<Schema.Schema.Type<typeof State>>

export const Info = Schema.Struct({
  state: State,
  nodes: Schema.Array(Node),
  edges: Schema.Array(Edge),
}).annotate({ identifier: "Graph" })
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>

export const StatePatch = Schema.Struct({
  selectedNodeID: Schema.optional(Schema.NullOr(NodeID)),
})
export type StatePatch = Schema.Schema.Type<typeof StatePatch>

export const NodeCreate = Schema.Struct({
  id: Schema.optional(NodeID),
  type: NodeType,
  name: Schema.optional(Schema.String),
  providerID: Schema.optional(ProviderID),
  modelID: Schema.optional(ModelID),
  model: Schema.optional(Model),
  instructions: Schema.optional(Schema.String),
  sameChat: Schema.optional(Schema.Boolean),
  canSpawnAgents: Schema.optional(Schema.Boolean),
  currentChatSessionID: Schema.optional(SessionID),
  position: Schema.optional(Position),
  size: Schema.optional(Size),
  permission: Schema.optional(Permission.Ruleset),
  toolPolicy: Schema.optional(ToolPolicy),
  mcpPolicy: Schema.optional(McpPolicy),
})
export type NodeCreate = Schema.Schema.Type<typeof NodeCreate>

export const NodePatch = Schema.Struct({
  name: Schema.optional(Schema.String),
  providerID: Schema.optional(Schema.NullOr(ProviderID)),
  modelID: Schema.optional(Schema.NullOr(ModelID)),
  model: Schema.optional(Schema.NullOr(Model)),
  instructions: Schema.optional(Schema.NullOr(Schema.String)),
  sameChat: Schema.optional(Schema.Boolean),
  canSpawnAgents: Schema.optional(Schema.Boolean),
  currentChatSessionID: Schema.optional(Schema.NullOr(SessionID)),
  position: Schema.optional(Position),
  size: Schema.optional(Schema.NullOr(Size)),
  permission: Schema.optional(Schema.NullOr(Permission.Ruleset)),
  toolPolicy: Schema.optional(Schema.NullOr(ToolPolicy)),
  mcpPolicy: Schema.optional(Schema.NullOr(McpPolicy)),
})
export type NodePatch = Schema.Schema.Type<typeof NodePatch>

export const EdgeCreate = Schema.Struct({
  id: Schema.optional(EdgeID),
  sourceNodeID: NodeID,
  targetNodeID: NodeID,
})
export type EdgeCreate = Schema.Schema.Type<typeof EdgeCreate>
