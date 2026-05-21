# 05 Backend And API Impact

## Goal

Identify the backend, API, and persistence changes needed to support graph-based multi-agent workflows.

OpenNodus should avoid rewriting the whole OpenCode backend at once. The best path is to add a graph orchestration layer that uses the existing provider, tool, MCP, permission, and session systems.

## Persistence

The app needs to store graph state.

Required persisted data:

- Nodes.
- Edges.
- Node positions.
- Node sizes.
- Node settings.
- Node chat/context reuse setting.
- Node permissions.
- Active chat target.
- Runtime/session associations.
- Per-node chat history references.

This may require new database tables or additions to existing session/project data.

## Suggested Data Areas

Graph workspace:

- Graph ID.
- Session ID.
- Project ID.
- Nodes.
- Edges.
- Layout metadata.

Node configuration:

- Provider/model.
- Instructions.
- Tool permissions.
- MCP permissions.
- Spawn-agent setting.
- Same chat setting.
- Context policy.

Runtime state:

- Current node status.
- Current request ID.
- Pending permission request.
- Last error.
- Current per-node chat/context ID.

## Session Model

Each graph is its own session.

The existing OpenCode "new chat" action should become a new OpenNodus session. A new session belongs to the same workspace/project folder, but it receives a separate graph and a separate set of node chats.

Required behavior:

- New session creates a new graph.
- New graph starts with one default Orchestrator node.
- Each node can maintain its own chat/context.
- Switching the selected chat target switches the visible chat history to that node.

## API Changes

The frontend will need APIs for:

- Creating nodes.
- Updating nodes.
- Deleting nodes.
- Creating edges.
- Deleting edges.
- Updating node position and size.
- Selecting chat target node.
- Updating a node's same-chat behavior.
- Sending message to a node.
- Reading chat history for the selected node.
- Reading node runtime status.
- Reading node permission requests.
- Approving or denying node permission requests.

## Runtime Orchestration Layer

The new orchestration layer should sit between the UI and the existing OpenCode agent/session execution.

Responsibilities:

- Resolve the selected node.
- Load node settings.
- Resolve whether the node should reuse an existing chat/context or create a fresh one.
- Validate graph links.
- Route messages.
- Enforce permission policy.
- Build provider/model requests.
- Pass context to agents.
- Collect results.
- Emit graph events.
- Persist execution history.

## Event System

The UI needs live updates for graph activity.

Events should include:

- Node created.
- Node updated.
- Node deleted.
- Edge created.
- Edge deleted.
- Node status changed.
- Node requested permission.
- Node started tool use.
- Node completed tool use.
- Node sent message.
- Node received message.
- Node errored.

The existing session event stream may be reusable, but events need node IDs.

## Migration Strategy

Recommended implementation order:

1. Add graph UI shell with static nodes.
2. Persist graph nodes and edges.
3. Add node settings panel.
4. Add chat target selection.
5. Add per-node visible chat history switching.
6. Route user messages to selected node.
7. Add default Orchestrator creation for new sessions.
8. Add orchestrator-to-agent delegation.
9. Add same-chat context reuse per node.
10. Split permissions by node.
11. Add sequential and parallel orchestrator agent calls.
12. Add live node runtime states.
13. Add provider/model capability-specific settings.

## Risks

- Existing session assumptions may expect one active agent.
- Permission flow may be tightly coupled to session-level state.
- Provider/model capability handling may not be normalized enough yet.
- The UI could become confusing if chat history, graph events, and node logs are not clearly separated.
- Agent-to-agent links may create loops if graph execution does not enforce limits.

## Open Questions

- Each graph should become the new session model.
- Each node should have its own chat/context reference internally.
- Should an orchestrator own all child agent messages, or should every agent have its own transcript?
- Should graph execution be deterministic enough to replay?
- Same-chat state should be stored per node within the graph session.
