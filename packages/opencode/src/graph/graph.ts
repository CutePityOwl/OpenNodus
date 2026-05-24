import { Database } from "@/storage/db"
import { NotFoundError } from "@/storage/storage"
import { and, eq, or } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { GraphEdgeTable, GraphNodeTable, GraphStateTable } from "./graph.sql"
import { EdgeID, NodeID } from "./schema"
import type { Edge, EdgeCreate, Info, Node, NodeCreate, NodePatch, State, StatePatch } from "./schema"
import { SessionID } from "@/session/schema"

type Tx = Parameters<typeof Database.use>[0] extends (trx: infer D) => any ? D : never

const db = <T>(fn: (d: Tx) => T) => Effect.sync(() => Database.use(fn))

type StateRow = typeof GraphStateTable.$inferSelect
type NodeRow = typeof GraphNodeTable.$inferSelect
type EdgeRow = typeof GraphEdgeTable.$inferSelect

const defaultPosition = { x: 0, y: 0 }
const defaultOrchestratorPosition = { x: 0, y: 0 }

function stateFromRow(row: StateRow): State {
  return {
    graphSessionID: row.graph_session_id,
    selectedNodeID: row.selected_node_id ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  }
}

function nodeFromRow(row: NodeRow): Node {
  return {
    id: row.id,
    graphSessionID: row.graph_session_id,
    type: row.type,
    name: row.name,
    providerID: row.provider_id ?? undefined,
    modelID: row.model_id ?? undefined,
    model: row.model ?? undefined,
    instructions: row.instructions ?? undefined,
    sameChat: row.same_chat,
    canSpawnAgents: row.can_spawn_agents,
    currentChatSessionID: row.current_chat_session_id ?? undefined,
    position: row.position,
    size: row.size ?? undefined,
    permission: row.permission ?? undefined,
    toolPolicy: row.tool_policy ?? undefined,
    mcpPolicy: row.mcp_policy ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  }
}

function edgeFromRow(row: EdgeRow): Edge {
  return {
    id: row.id,
    graphSessionID: row.graph_session_id,
    sourceNodeID: row.source_node_id,
    targetNodeID: row.target_node_id,
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  }
}

function nullable<T>(value: T | null | undefined) {
  return value === undefined ? undefined : value
}

export interface Interface {
  readonly get: (graphSessionID: SessionID) => Effect.Effect<Info, NotFoundError>
  readonly ensure: (graphSessionID: SessionID) => Effect.Effect<Info>
  readonly getNode: (graphSessionID: SessionID, nodeID: NodeID) => Effect.Effect<Node, NotFoundError>
  readonly findNodeByChatSessionID: (
    chatSessionID: SessionID,
  ) => Effect.Effect<{ graph: Info; node: Node }, NotFoundError>
  readonly updateState: (input: { graphSessionID: SessionID; patch: StatePatch }) => Effect.Effect<State, NotFoundError>
  readonly createNode: (input: { graphSessionID: SessionID; node: NodeCreate }) => Effect.Effect<Node, NotFoundError>
  readonly updateNode: (input: {
    graphSessionID: SessionID
    nodeID: NodeID
    patch: NodePatch
  }) => Effect.Effect<Node, NotFoundError>
  readonly deleteNode: (input: { graphSessionID: SessionID; nodeID: NodeID }) => Effect.Effect<void, NotFoundError>
  readonly createEdge: (input: { graphSessionID: SessionID; edge: EdgeCreate }) => Effect.Effect<Edge, NotFoundError>
  readonly deleteEdge: (input: { graphSessionID: SessionID; edgeID: EdgeID }) => Effect.Effect<void, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opennodus/Graph") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const getState = Effect.fn("Graph.getState")(function* (graphSessionID: SessionID) {
      const row = yield* db((d) =>
        d.select().from(GraphStateTable).where(eq(GraphStateTable.graph_session_id, graphSessionID)).get(),
      )
      if (!row) return yield* Effect.fail(new NotFoundError({ message: `Graph not found: ${graphSessionID}` }))
      return stateFromRow(row)
    })

    const ensureState = Effect.fn("Graph.ensureState")(function* (graphSessionID: SessionID) {
      const existing = yield* db((d) =>
        d.select().from(GraphStateTable).where(eq(GraphStateTable.graph_session_id, graphSessionID)).get(),
      )
      if (existing) return stateFromRow(existing)

      const now = Date.now()
      const row: typeof GraphStateTable.$inferInsert = {
        graph_session_id: graphSessionID,
        time_created: now,
        time_updated: now,
      }
      yield* db((d) => d.insert(GraphStateTable).values(row).run())
      return stateFromRow({
        graph_session_id: graphSessionID,
        selected_node_id: null,
        time_created: now,
        time_updated: now,
      })
    })

    const nodes = Effect.fn("Graph.nodes")(function* (graphSessionID: SessionID) {
      const rows = yield* db((d) =>
        d.select().from(GraphNodeTable).where(eq(GraphNodeTable.graph_session_id, graphSessionID)).all(),
      )
      return rows.map(nodeFromRow)
    })

    const edges = Effect.fn("Graph.edges")(function* (graphSessionID: SessionID) {
      const rows = yield* db((d) =>
        d.select().from(GraphEdgeTable).where(eq(GraphEdgeTable.graph_session_id, graphSessionID)).all(),
      )
      return rows.map(edgeFromRow)
    })

    const get = Effect.fn("Graph.get")(function* (graphSessionID: SessionID) {
      const state = yield* getState(graphSessionID)
      return {
        state,
        nodes: yield* nodes(graphSessionID),
        edges: yield* edges(graphSessionID),
      }
    })

    const createDefaultOrchestrator = Effect.fn("Graph.createDefaultOrchestrator")(function* (
      graphSessionID: SessionID,
    ) {
      const now = Date.now()
      const row: typeof GraphNodeTable.$inferInsert = {
        id: NodeID.ascending(),
        graph_session_id: graphSessionID,
        type: "orchestrator",
        name: "Orchestrator",
        same_chat: true,
        can_spawn_agents: true,
        current_chat_session_id: graphSessionID,
        position: defaultOrchestratorPosition,
        time_created: now,
        time_updated: now,
      }
      yield* db((d) => d.insert(GraphNodeTable).values(row).run())
      yield* db((d) =>
        d
          .update(GraphStateTable)
          .set({ selected_node_id: row.id, time_updated: now })
          .where(eq(GraphStateTable.graph_session_id, graphSessionID))
          .run(),
      )
      return nodeFromRow({
        id: row.id,
        graph_session_id: graphSessionID,
        type: "orchestrator",
        name: row.name,
        provider_id: null,
        model_id: null,
        model: null,
        instructions: null,
        same_chat: row.same_chat,
        can_spawn_agents: row.can_spawn_agents,
        current_chat_session_id: graphSessionID,
        position: row.position,
        size: null,
        permission: null,
        tool_policy: null,
        mcp_policy: null,
        time_created: now,
        time_updated: now,
      })
    })

    const ensure = Effect.fn("Graph.ensure")(function* (graphSessionID: SessionID) {
      yield* ensureState(graphSessionID)
      const existingNodes = yield* nodes(graphSessionID)

      if (existingNodes.length === 0) {
        yield* createDefaultOrchestrator(graphSessionID)
      } else {
        const state = yield* getState(graphSessionID).pipe(Effect.orDie)
        const selectedExists =
          state.selectedNodeID !== undefined && existingNodes.some((node) => node.id === state.selectedNodeID)
        if (!selectedExists) {
          const fallback = existingNodes.find((node) => node.type === "orchestrator") ?? existingNodes[0]
          yield* updateState({ graphSessionID, patch: { selectedNodeID: fallback.id } }).pipe(Effect.orDie)
        }
      }

      const state = yield* getState(graphSessionID).pipe(Effect.orDie)
      return {
        state,
        nodes: yield* nodes(graphSessionID),
        edges: yield* edges(graphSessionID),
      }
    })

    const updateState: Interface["updateState"] = Effect.fn("Graph.updateState")(function* (input) {
      yield* getState(input.graphSessionID)
      const patch: Partial<typeof GraphStateTable.$inferInsert> = {
        time_updated: Date.now(),
      }
      if ("selectedNodeID" in input.patch) patch.selected_node_id = input.patch.selectedNodeID ?? null

      yield* db((d) =>
        d.update(GraphStateTable).set(patch).where(eq(GraphStateTable.graph_session_id, input.graphSessionID)).run(),
      )
      return yield* getState(input.graphSessionID)
    })

    const createNode: Interface["createNode"] = Effect.fn("Graph.createNode")(function* (input) {
      yield* getState(input.graphSessionID)
      const now = Date.now()
      const row: typeof GraphNodeTable.$inferInsert = {
        id: NodeID.ascending(input.node.id),
        graph_session_id: input.graphSessionID,
        type: input.node.type,
        name: input.node.name ?? (input.node.type === "orchestrator" ? "Orchestrator" : "Agent"),
        provider_id: input.node.providerID,
        model_id: input.node.modelID,
        model: input.node.model,
        instructions: input.node.instructions,
        same_chat: input.node.sameChat ?? true,
        can_spawn_agents: input.node.canSpawnAgents ?? false,
        current_chat_session_id: input.node.currentChatSessionID,
        position: input.node.position ?? defaultPosition,
        size: input.node.size,
        permission: input.node.permission,
        tool_policy: input.node.toolPolicy,
        mcp_policy: input.node.mcpPolicy,
        time_created: now,
        time_updated: now,
      }
      yield* db((d) => d.insert(GraphNodeTable).values(row).run())
      return nodeFromRow({
        id: row.id,
        graph_session_id: input.graphSessionID,
        type: input.node.type,
        name: row.name,
        provider_id: row.provider_id ?? null,
        model_id: row.model_id ?? null,
        model: row.model ?? null,
        instructions: row.instructions ?? null,
        same_chat: row.same_chat,
        can_spawn_agents: row.can_spawn_agents,
        current_chat_session_id: row.current_chat_session_id ?? null,
        position: row.position,
        size: row.size ?? null,
        permission: row.permission ?? null,
        tool_policy: row.tool_policy ?? null,
        mcp_policy: row.mcp_policy ?? null,
        time_created: now,
        time_updated: now,
      })
    })

    const getNode = Effect.fn("Graph.getNode")(function* (graphSessionID: SessionID, nodeID: NodeID) {
      const row = yield* db((d) =>
        d
          .select()
          .from(GraphNodeTable)
          .where(and(eq(GraphNodeTable.graph_session_id, graphSessionID), eq(GraphNodeTable.id, nodeID)))
          .get(),
      )
      if (!row) return yield* Effect.fail(new NotFoundError({ message: `Graph node not found: ${nodeID}` }))
      return nodeFromRow(row)
    })

    const findNodeByChatSessionID: Interface["findNodeByChatSessionID"] = Effect.fn("Graph.findNodeByChatSessionID")(
      function* (chatSessionID) {
        const row = yield* db((d) =>
          d.select().from(GraphNodeTable).where(eq(GraphNodeTable.current_chat_session_id, chatSessionID)).get(),
        )
        if (!row) {
          const graphState = yield* db((d) =>
            d.select().from(GraphStateTable).where(eq(GraphStateTable.graph_session_id, chatSessionID)).get(),
          )
          if (graphState) {
            const graph = yield* get(SessionID.make(graphState.graph_session_id))
            const node =
              graph.nodes.find((item) => item.type === "orchestrator" && item.currentChatSessionID === chatSessionID) ??
              graph.nodes.find((item) => item.type === "orchestrator" && !item.currentChatSessionID) ??
              graph.nodes.find((item) => item.type === "orchestrator")
            if (node) return { graph, node }
          }
        }
        if (!row) {
          return yield* Effect.fail(
            new NotFoundError({ message: `Graph node not found for session: ${chatSessionID}` }),
          )
        }
        const graph = yield* get(SessionID.make(row.graph_session_id))
        return { graph, node: nodeFromRow(row) }
      },
    )

    const updateNode: Interface["updateNode"] = Effect.fn("Graph.updateNode")(function* (input) {
      yield* getNode(input.graphSessionID, input.nodeID)
      const patch: Partial<typeof GraphNodeTable.$inferInsert> = {
        time_updated: Date.now(),
      }
      if (input.patch.name !== undefined) patch.name = input.patch.name
      if ("providerID" in input.patch) patch.provider_id = nullable(input.patch.providerID)
      if ("modelID" in input.patch) patch.model_id = nullable(input.patch.modelID)
      if ("model" in input.patch) patch.model = nullable(input.patch.model)
      if ("instructions" in input.patch) patch.instructions = nullable(input.patch.instructions)
      if (input.patch.sameChat !== undefined) patch.same_chat = input.patch.sameChat
      if (input.patch.canSpawnAgents !== undefined) patch.can_spawn_agents = input.patch.canSpawnAgents
      if ("currentChatSessionID" in input.patch)
        patch.current_chat_session_id = nullable(input.patch.currentChatSessionID)
      if (input.patch.position !== undefined) patch.position = input.patch.position
      if ("size" in input.patch) patch.size = nullable(input.patch.size)
      if ("permission" in input.patch) patch.permission = nullable(input.patch.permission)
      if ("toolPolicy" in input.patch) patch.tool_policy = nullable(input.patch.toolPolicy)
      if ("mcpPolicy" in input.patch) patch.mcp_policy = nullable(input.patch.mcpPolicy)

      yield* db((d) =>
        d
          .update(GraphNodeTable)
          .set(patch)
          .where(and(eq(GraphNodeTable.graph_session_id, input.graphSessionID), eq(GraphNodeTable.id, input.nodeID)))
          .run(),
      )
      return yield* getNode(input.graphSessionID, input.nodeID)
    })

    const deleteNode: Interface["deleteNode"] = Effect.fn("Graph.deleteNode")(function* (input) {
      yield* getNode(input.graphSessionID, input.nodeID)
      yield* db((d) =>
        d
          .delete(GraphEdgeTable)
          .where(
            and(
              eq(GraphEdgeTable.graph_session_id, input.graphSessionID),
              or(eq(GraphEdgeTable.source_node_id, input.nodeID), eq(GraphEdgeTable.target_node_id, input.nodeID))!,
            ),
          )
          .run(),
      )
      yield* db((d) =>
        d
          .delete(GraphNodeTable)
          .where(and(eq(GraphNodeTable.graph_session_id, input.graphSessionID), eq(GraphNodeTable.id, input.nodeID)))
          .run(),
      )
      yield* db((d) =>
        d
          .update(GraphStateTable)
          .set({ selected_node_id: null, time_updated: Date.now() })
          .where(
            and(
              eq(GraphStateTable.graph_session_id, input.graphSessionID),
              eq(GraphStateTable.selected_node_id, input.nodeID),
            ),
          )
          .run(),
      )
    })

    const createEdge: Interface["createEdge"] = Effect.fn("Graph.createEdge")(function* (input) {
      yield* getNode(input.graphSessionID, input.edge.sourceNodeID)
      yield* getNode(input.graphSessionID, input.edge.targetNodeID)
      const now = Date.now()
      const row: typeof GraphEdgeTable.$inferInsert = {
        id: EdgeID.ascending(input.edge.id),
        graph_session_id: input.graphSessionID,
        source_node_id: input.edge.sourceNodeID,
        target_node_id: input.edge.targetNodeID,
        time_created: now,
        time_updated: now,
      }
      yield* db((d) => d.insert(GraphEdgeTable).values(row).run())
      return edgeFromRow({
        id: row.id,
        graph_session_id: input.graphSessionID,
        source_node_id: input.edge.sourceNodeID,
        target_node_id: input.edge.targetNodeID,
        time_created: now,
        time_updated: now,
      })
    })

    const deleteEdge: Interface["deleteEdge"] = Effect.fn("Graph.deleteEdge")(function* (input) {
      const row = yield* db((d) =>
        d
          .select()
          .from(GraphEdgeTable)
          .where(and(eq(GraphEdgeTable.graph_session_id, input.graphSessionID), eq(GraphEdgeTable.id, input.edgeID)))
          .get(),
      )
      if (!row) return yield* Effect.fail(new NotFoundError({ message: `Graph edge not found: ${input.edgeID}` }))
      yield* db((d) =>
        d
          .delete(GraphEdgeTable)
          .where(and(eq(GraphEdgeTable.graph_session_id, input.graphSessionID), eq(GraphEdgeTable.id, input.edgeID)))
          .run(),
      )
    })

    return Service.of({
      get,
      ensure,
      getNode,
      findNodeByChatSessionID,
      updateState,
      createNode,
      updateNode,
      deleteNode,
      createEdge,
      deleteEdge,
    })
  }),
)

export const defaultLayer = layer

export * from "./schema"
export * as Graph from "./graph"
