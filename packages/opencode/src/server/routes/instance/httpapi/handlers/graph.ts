import { Graph } from "@/graph/graph"
import { Session } from "@/session/session"
import { EdgeID, NodeID } from "@/graph/schema"
import { SessionID } from "@/session/schema"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import * as SessionError from "./session-errors"

export const graphHandlers = HttpApiBuilder.group(InstanceHttpApi, "graph", (handlers) =>
  Effect.gen(function* () {
    const graph = yield* Graph.Service
    const session = yield* Session.Service

    const requireSession = (sessionID: SessionID) => SessionError.mapStorageNotFound(session.get(sessionID))

    const get = Effect.fn("GraphHttpApi.get")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* SessionError.mapStorageNotFound(graph.get(ctx.params.sessionID))
    })

    const ensure = Effect.fn("GraphHttpApi.ensure")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* graph.ensure(ctx.params.sessionID)
    })

    const updateState = Effect.fn("GraphHttpApi.updateState")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: Graph.StatePatch
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* SessionError.mapStorageNotFound(
        graph.updateState({ graphSessionID: ctx.params.sessionID, patch: ctx.payload }),
      )
    })

    const createNode = Effect.fn("GraphHttpApi.createNode")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: Graph.NodeCreate
    }) {
      yield* requireSession(ctx.params.sessionID)
      const node = yield* SessionError.mapStorageNotFound(
        graph.createNode({ graphSessionID: ctx.params.sessionID, node: ctx.payload }),
      )
      if (node.currentChatSessionID && node.permission) {
        yield* session.setPermission({ sessionID: node.currentChatSessionID, permission: node.permission })
      }
      return node
    })

    const updateNode = Effect.fn("GraphHttpApi.updateNode")(function* (ctx: {
      params: { sessionID: SessionID; nodeID: NodeID }
      payload: Graph.NodePatch
    }) {
      yield* requireSession(ctx.params.sessionID)
      const node = yield* SessionError.mapStorageNotFound(
        graph.updateNode({ graphSessionID: ctx.params.sessionID, nodeID: ctx.params.nodeID, patch: ctx.payload }),
      )
      if ("permission" in ctx.payload && node.currentChatSessionID) {
        yield* session.setPermission({ sessionID: node.currentChatSessionID, permission: node.permission ?? [] })
      }
      return node
    })

    const deleteNode = Effect.fn("GraphHttpApi.deleteNode")(function* (ctx: {
      params: { sessionID: SessionID; nodeID: NodeID }
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* SessionError.mapStorageNotFound(
        graph.deleteNode({ graphSessionID: ctx.params.sessionID, nodeID: ctx.params.nodeID }),
      )
      return true
    })

    const createEdge = Effect.fn("GraphHttpApi.createEdge")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: Graph.EdgeCreate
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* SessionError.mapStorageNotFound(
        graph.createEdge({ graphSessionID: ctx.params.sessionID, edge: ctx.payload }),
      )
    })

    const deleteEdge = Effect.fn("GraphHttpApi.deleteEdge")(function* (ctx: {
      params: { sessionID: SessionID; edgeID: EdgeID }
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* SessionError.mapStorageNotFound(
        graph.deleteEdge({ graphSessionID: ctx.params.sessionID, edgeID: ctx.params.edgeID }),
      )
      return true
    })

    return handlers
      .handle("get", get)
      .handle("ensure", ensure)
      .handle("updateState", updateState)
      .handle("createNode", createNode)
      .handle("updateNode", updateNode)
      .handle("deleteNode", deleteNode)
      .handle("createEdge", createEdge)
      .handle("deleteEdge", deleteEdge)
  }),
)
