import { Graph } from "@/graph/graph"
import { EdgeID, NodeID } from "@/graph/schema"
import { SessionID } from "@/session/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { ApiNotFoundError } from "../errors"
import { described } from "./metadata"

const root = "/graph"

export const GraphPaths = {
  get: `${root}/:sessionID`,
  ensure: `${root}/:sessionID/ensure`,
  updateState: `${root}/:sessionID`,
  createNode: `${root}/:sessionID/node`,
  updateNode: `${root}/:sessionID/node/:nodeID`,
  deleteNode: `${root}/:sessionID/node/:nodeID`,
  createEdge: `${root}/:sessionID/edge`,
  deleteEdge: `${root}/:sessionID/edge/:edgeID`,
} as const

export const GraphApi = HttpApi.make("graph")
  .add(
    HttpApiGroup.make("graph")
      .add(
        HttpApiEndpoint.get("get", GraphPaths.get, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Graph.Info, "Get graph"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "graph.get",
            summary: "Get graph",
            description: "Retrieve graph state, nodes, and edges for an OpenNodus graph session.",
          }),
        ),
        HttpApiEndpoint.post("ensure", GraphPaths.ensure, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Graph.Info, "Ensured graph"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "graph.ensure",
            summary: "Ensure graph",
            description: "Create graph state for a session if missing, then return the graph.",
          }),
        ),
        HttpApiEndpoint.patch("updateState", GraphPaths.updateState, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: Graph.StatePatch,
          success: described(Graph.State, "Updated graph state"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "graph.updateState",
            summary: "Update graph state",
            description: "Update graph-level state such as the selected node.",
          }),
        ),
        HttpApiEndpoint.post("createNode", GraphPaths.createNode, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: Graph.NodeCreate,
          success: described(Graph.Node, "Created graph node"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "graph.node.create",
            summary: "Create graph node",
            description: "Create an Orchestrator or Agent node inside a graph session.",
          }),
        ),
        HttpApiEndpoint.patch("updateNode", GraphPaths.updateNode, {
          params: { sessionID: SessionID, nodeID: NodeID },
          query: WorkspaceRoutingQuery,
          payload: Graph.NodePatch,
          success: described(Graph.Node, "Updated graph node"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "graph.node.update",
            summary: "Update graph node",
            description: "Update graph node settings, position, size, or chat references.",
          }),
        ),
        HttpApiEndpoint.delete("deleteNode", GraphPaths.deleteNode, {
          params: { sessionID: SessionID, nodeID: NodeID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Deleted graph node"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "graph.node.delete",
            summary: "Delete graph node",
            description: "Delete a graph node and its attached edges.",
          }),
        ),
        HttpApiEndpoint.post("createEdge", GraphPaths.createEdge, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: Graph.EdgeCreate,
          success: described(Graph.Edge, "Created graph edge"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "graph.edge.create",
            summary: "Create graph edge",
            description: "Create a directed edge between two graph nodes.",
          }),
        ),
        HttpApiEndpoint.delete("deleteEdge", GraphPaths.deleteEdge, {
          params: { sessionID: SessionID, edgeID: EdgeID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Deleted graph edge"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "graph.edge.delete",
            summary: "Delete graph edge",
            description: "Delete a graph edge.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "graph",
          description: "OpenNodus graph persistence routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opennodus graph HttpApi",
      version: "0.0.1",
      description: "Graph persistence API for OpenNodus sessions.",
    }),
  )
