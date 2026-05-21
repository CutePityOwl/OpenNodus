# 00 Master Implementation Plan

This document is the implementation order for the OpenNodus graph overhaul.

The goal is to avoid building a graph UI on top of unstable assumptions. The current OpenCode codebase is centered around one visible `sessionID`, one message timeline, and one prompt target. OpenNodus needs one visible graph session with multiple node-level chats inside it.

The safest path is to first build a compatibility layer between the current session system and the new graph/node model. After that, the graph UI and orchestration logic can be added without repeatedly rewriting the same foundations.

## Core Technical Direction

Keep the existing backend session as the user-facing graph session.

Add graph data keyed by that existing `sessionID`.

Each node can then point to an internal chat session ID.

```text
Visible Graph Session
  sessionID
  graph
    nodes
      nodeID
      type
      settings
      currentChatSessionID
    edges
      edgeID
      sourceNodeID
      targetNodeID
```

This lets OpenNodus reuse the existing OpenCode session, message, permission, provider, tool, MCP, event, and sync systems while gradually changing the product model.

## Current System Areas

Important frontend areas:

- `packages/app/src/pages/session.tsx`
- `packages/app/src/components/prompt-input/submit.ts`
- `packages/app/src/context/global-sync.tsx`
- `packages/app/src/context/global-sync/event-reducer.ts`
- `packages/app/src/context/global-sync/types.ts`
- `packages/app/src/pages/session/composer/*`
- `packages/app/src/pages/layout/*`

Important backend areas:

- `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`
- `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts`
- `packages/opencode/src/session/session.ts`
- `packages/opencode/src/session/session.sql.ts`
- `packages/opencode/src/session/schema.ts`
- `packages/opencode/src/sync/*`
- `packages/opencode/src/permission/*`

Important desktop areas:

- `packages/desktop/src/main/index.ts`
- `packages/desktop/src/main/server.ts`
- `packages/desktop/electron-builder.config.ts`

The desktop layer should not need much graph-specific logic. Most work belongs in `packages/app` and `packages/opencode`.

## Phase 1: Language And Product Framing

### Goal

Start moving the app language from "chat" to "session" without changing runtime behavior yet.

### Changes

Update visible UI labels where appropriate:

- "New Chat" becomes "New Session".
- Chat/session wording should be reviewed carefully.
- Keep technical backend names unchanged for now.

Likely files:

- `packages/app/src/desktop-menu.ts`
- session/sidebar components under `packages/app/src/pages/layout`
- i18n entries under `packages/app/src/i18n`

### Why

OpenNodus uses a graph as the session. The user-facing unit is no longer just a chat. Renaming early reduces confusion before graph features appear.

### Consequences

This should be low risk if it only changes labels. Avoid renaming backend APIs or data structures in this phase.

### Completion Check

- App still builds.
- Creating a new session behaves exactly as before.
- No backend session behavior changes.

### Implementation Status

Completed in the first implementation slice:

- Existing "New Session" language was verified in the desktop/app UI.
- Visible desktop product text was moved from OpenCode to OpenNodus where it is product framing, not provider-specific naming.
- Desktop deep links were aligned to the `opennodus://` protocol already registered by the Electron shell.
- Backend session APIs, session IDs, prompt routing, and runtime behavior were intentionally left unchanged.

## Phase 2: Graph Persistence Foundation

### Goal

Add persistent graph data keyed by existing `sessionID`.

### Changes

Add backend graph storage for:

- Graph metadata.
- Nodes.
- Edges.
- Selected/default node.
- Node settings.
- Node position.
- Node size.
- Node `currentChatSessionID`.

Possible new backend files:

- `packages/opencode/src/graph/graph.ts`
- `packages/opencode/src/graph/graph.sql.ts`
- `packages/opencode/src/graph/schema.ts`
- `packages/opencode/src/server/routes/instance/httpapi/groups/graph.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/graph.ts`

Possible tables:

```text
graph_node
  id
  graph_session_id
  type
  name
  provider_id
  model_id
  instructions
  same_chat
  can_spawn_agents
  current_chat_session_id
  position_json
  size_json
  permission_json
  tool_policy_json
  mcp_policy_json
  time_created
  time_updated

graph_edge
  id
  graph_session_id
  source_node_id
  target_node_id
  time_created
  time_updated

graph_state
  graph_session_id
  selected_node_id
  time_created
  time_updated
```

### Why

The current session system cannot represent multiple nodes, edges, or per-node settings. Adding graph storage separately avoids destabilizing existing session tables.

### Consequences

The backend now has two layers:

- Existing sessions for chat/runtime.
- Graph records for OpenNodus orchestration.

This adds mapping complexity, but keeps the existing engine reusable.

### Completion Check

- Can create/read/update graph state for a session.
- Can create/read/update/delete nodes.
- Can create/read/update/delete edges.
- Existing OpenCode sessions still work.
- No graph UI required yet.

### Implementation Status

Completed in the second implementation slice:

- Added graph persistence tables for graph state, nodes, and edges.
- Added `Graph.Service` with graph ensure/get, state update, node CRUD, and edge create/delete behavior.
- Added typed `/graph/:sessionID` HTTP API routes for the persistence layer.
- Added a database migration for the new graph tables and indexes.
- Kept session creation, prompt routing, sidebar behavior, and UI unchanged; those remain later phases.

## Phase 3: Default Orchestrator Creation

### Goal

Every new graph session should start with one Orchestrator node.

### Changes

When a new user-facing session is created:

1. Create the normal backend session.
2. Create a graph state for that session.
3. Create a default Orchestrator node.
4. Create or assign the Orchestrator's internal chat session.
5. Mark the Orchestrator as selected/default.

This can be implemented either:

- Inside the new graph API after session creation.
- Or in a new graph-session creation endpoint that wraps existing session creation.

Preferred long-term API:

```text
POST /graph-session
```

Internally it creates the existing session and graph records together.

### Why

OpenNodus must not open into an empty graph with no usable chat target. The default Orchestrator preserves the current app behavior: user creates a session and can immediately send a message.

### Consequences

Session creation becomes more complex. If graph creation fails after session creation, the app must either roll back or recover by creating the missing default graph on load.

### Completion Check

- New session creates a graph.
- New graph contains one Orchestrator.
- Orchestrator has a valid internal chat session reference.
- Loading an old session can recover by creating missing graph data.

### Implementation Status

- Added default graph bootstrap to `Graph.Service.ensure`.
- New top-level session creation now ensures graph records exist before returning.
- Empty graph recovery now creates one selected Orchestrator node.
- The default Orchestrator currently uses the graph session itself as its chat session so existing chat behavior remains intact until internal node-chat routing and hidden child sessions are implemented.

## Phase 4: Selected Node State

### Goal

Introduce selected-node state while keeping the current session route.

### Changes

Keep:

```text
/session/:id
```

Where `:id` remains the graph session ID.

Add frontend state for:

- Current graph session ID.
- Selected node ID.
- Selected node's internal chat session ID.

Likely frontend areas:

- New graph context/store under `packages/app/src/context/graph`
- Session page integration in `packages/app/src/pages/session.tsx`
- SDK client additions if graph API is generated or manually wrapped

### Why

The app must stop assuming that route `params.id` is the same thing as the visible message timeline source.

### Consequences

From this phase onward, there are two important IDs:

- `graphSessionID`: the visible OpenNodus session.
- `nodeChatSessionID`: the selected node's chat history/runtime session.

This distinction must be kept explicit in code.

### Completion Check

- Session route still loads.
- Selected default Orchestrator is available.
- Frontend can resolve selected node chat session ID.
- No prompt routing changes yet.

### Implementation Status

- Regenerated the v2 SDK so the frontend has typed `graph` client methods and graph/node types.
- Added `GraphProvider` for the current graph session, selected node, and selected node chat session ID.
- Mounted graph state inside the directory-scoped providers.
- The session page now opens/ensures graph state for `params.id` while still rendering chat from the route session until Phase 5.

## Phase 5: Per-Node Chat History Display

### Goal

Make visible chat history come from the selected node instead of directly from the graph session.

### Changes

Modify `packages/app/src/pages/session.tsx`:

Current pattern:

```ts
const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))
```

New pattern:

```ts
const visibleChatSessionID = createMemo(() => selectedNode()?.currentChatSessionID)
const messages = createMemo(() => (visibleChatSessionID() ? (sync.data.message[visibleChatSessionID()!] ?? []) : []))
```

History loading must also use the selected node chat session ID.

Areas affected:

- Message timeline.
- History pagination.
- Hash scroll.
- Followups.
- Revert controls.
- Busy state.
- Permission/question dock.

### Why

This is the core compatibility milestone. If the app can show one node's chat through the existing timeline, it can later show many nodes.

### Consequences

Some existing features may assume `params.id`:

- Revert.
- Followup queue.
- Active message hash.
- Session diff.
- Busy state.
- Permission dock.

Each must be reviewed and either mapped to `nodeChatSessionID` or intentionally kept graph-session-level.

### Completion Check

- Selecting default Orchestrator shows its chat.
- Existing timeline still renders.
- History pagination works for selected node chat.
- Switching selected node changes visible history.
- No graph canvas required yet.

## Phase 6: Prompt Submit Through Selected Node

### Goal

The composer sends messages to the selected node's internal chat session.

### Changes

Modify prompt submission in:

- `packages/app/src/components/prompt-input/submit.ts`

Current behavior:

- Uses `params.id` as the session to create/send to.
- Reads provider/model/agent from local UI state.

New behavior:

- Resolve selected node.
- Use selected node's `currentChatSessionID`.
- Use selected node's provider/model/agent settings.
- If no selected node exists, default to first Orchestrator.

For a new session:

- Create graph session.
- Create default Orchestrator.
- Send prompt to default Orchestrator's internal chat session.

### Why

This makes the existing OpenCode chat loop run through the OpenNodus node abstraction. Once this works, the graph UI can be added without changing the basic send/receive path again.

### Consequences

Local model/agent state may become secondary. Eventually provider/model selection should belong to node settings, not global local UI state.

### Completion Check

- Sending a message to default Orchestrator works.
- Message appears in selected node chat history.
- Busy state follows selected node chat.
- Existing provider/model execution still works.

## Phase 7: Basic Graph UI Shell

### Goal

Add an `xyflow` graph canvas to the session area.

### Changes

Add dependency if needed:

- `@xyflow/solid` or the appropriate Solid-compatible xyflow package.

Add graph UI components:

- Graph canvas.
- Orchestrator node component.
- Agent node component.
- Node selection.
- Node move.
- Node resize.
- Persisted position/size updates.

Likely files:

- `packages/app/src/pages/session/graph/*`
- `packages/app/src/pages/session.tsx`

### Why

Now that selected-node chat routing exists, graph UI can become the control surface without breaking messaging.

### Consequences

The session page layout changes substantially. The current `MessageTimeline` should move into a draggable/hideable chat history panel rather than being the only central view.

### Completion Check

- Graph renders default Orchestrator.
- Node can be selected.
- Node can move.
- Node size can change.
- Position/size persists after reload.
- Chat still works for selected node.

## Phase 8: Graph Context Menu And Node Creation

### Goal

Allow users to create nodes from the graph canvas.

### Changes

Right-click graph context menu:

- Add Orchestrator.
- Add Agent.

Behavior:

- Node appears at clicked graph coordinates.
- New node gets default settings.
- New node gets an internal chat session if needed.
- New node can be selected.

### Why

This is the first real multi-node user workflow.

### Consequences

Creating a node may require backend work:

- Create graph node.
- Create internal chat session.
- Link node to internal chat session.
- Persist node.

### Completion Check

- Right-click menu works.
- Add Orchestrator works.
- Add Agent works.
- Created nodes persist.
- Selecting a created node changes chat history.

## Phase 9: Node Settings Panel

### Goal

Add a right-side Node Settings panel.

### Changes

Each node gets a settings icon in the top-right corner.

Clicking it opens the Node Settings panel.

Initial settings:

- Node name.
- Node type.
- Provider.
- Model.
- Instructions.
- Same chat.
- Can spawn agents.
- Permissions/default permissions.
- MCP/tool access placeholders.

Provider/model-specific settings can be expanded later.

### Why

Node settings are where OpenNodus starts becoming meaningfully different from OpenCode. The provider/model must belong to the node, not only the global app state.

### Consequences

Changing provider/model on a node changes future calls to that node. It should not unexpectedly rewrite old messages.

Changing `Same chat` affects future calls. Existing chat history should not be deleted automatically.

### Completion Check

- Settings panel opens for selected node.
- Settings save to graph persistence.
- Node title/provider/model update in graph UI.
- Prompt submit uses node provider/model.

## Phase 10: Edges And Linking

### Goal

Allow users to connect nodes.

### Changes

Initial interaction:

1. Select source node.
2. Select target node.
3. Create edge.

Persist:

- Source node.
- Target node.
- Edge ID.

For now:

- Orchestrator to Agent is runtime-supported.
- Agent to Agent may be visually allowed later, but not executed in the first runtime.

### Why

Edges define the allowed communication paths for orchestration.

### Consequences

Graph cycles are allowed visually for now, but runtime execution must avoid uncontrolled loops.

### Completion Check

- Can link Orchestrator to Agent.
- Edges persist after reload.
- Edge direction is visually clear.
- Deleting nodes removes or invalidates related edges.

## Phase 11: Node-Level Permissions

### Goal

Split permissions by node.

### Changes

Use each node's internal chat session as the first permission boundary.

Required UI changes:

- Permission prompts show node name.
- Permission prompts show node type.
- Permission prompts show provider/model.
- Graph node shows waiting-for-permission state.

Backend/runtime direction:

- Store permission rules on node chat sessions or graph node settings.
- When a node executes, apply that node's permission rules.

### Why

Different nodes may have different trust levels. An Orchestrator approval must not silently authorize all connected agents.

### Consequences

Permission auto-accept needs review. Existing auto-accept is keyed by session/directory. OpenNodus needs node-aware scoping.

### Completion Check

- Permission request identifies the node.
- Approving one node does not approve another node.
- Node waiting state is visible.
- Existing permission reply flow still works.

## Phase 12: Orchestrator-To-Agent Runtime

### Goal

Make Orchestrator nodes able to call connected Agent nodes.

### Changes

Add a graph orchestration runtime layer.

Responsibilities:

- Resolve connected agents.
- Validate allowed edges.
- Build agent task prompts.
- Run agents through their node chat sessions.
- Return final agent results to orchestrator.
- Return agent failures to orchestrator as failure results.
- Emit node status events.

First runtime rule:

- Orchestrator to Agent only.
- No Agent to Agent execution yet.
- Orchestrator receives final results, not full agent transcripts.

### Why

This is the core OpenNodus behavior.

### Consequences

The orchestrator must communicate with the program/runtime, not directly mutate agents. This keeps routing, permissions, and history observable.

### Completion Check

- Orchestrator can call one connected agent.
- Agent result returns to orchestrator.
- Agent failure returns to orchestrator.
- Agent internal history remains node-local.

## Phase 13: Same Chat Behavior

### Goal

Implement `Same chat` exactly.

### Changes

When a node is called:

If `Same chat` is enabled:

- Use node's existing `currentChatSessionID`.
- Create one if missing.
- Reuse it on later calls.

If `Same chat` is disabled:

- Create a fresh internal chat session for the call.
- Use only explicitly passed context.
- Decide whether the node points to the latest fresh chat after the call.

### Why

This controls whether agents build memory or stay isolated.

### Consequences

This affects reproducibility and context size. Same-chat histories still need compaction/trimming because providers have context limits.

### Completion Check

- Same-chat enabled agent remembers previous calls.
- Same-chat disabled agent starts fresh each call.
- Multiple orchestrators calling the same same-chat agent reuse that agent's chat.

## Phase 14: Sequential And Parallel Agent Calls

### Goal

Allow orchestrators to call agents sequentially or in parallel.

### Changes

Runtime must support:

- Sequential task execution.
- Parallel task execution.
- Aggregating results.
- Returning failures per agent.
- Exposing node statuses during execution.

Sequential example:

1. Orchestrator calls UI Designer.
2. Orchestrator receives design result.
3. Orchestrator calls UI Coder with design context.

Parallel example:

1. Orchestrator calls Research Agent and Risk Agent at the same time.
2. Orchestrator receives both results.
3. Orchestrator combines them.

### Why

Some tasks depend on prior outputs. Others can run independently. OpenNodus needs both.

### Consequences

Parallel execution increases complexity:

- More active node states.
- More simultaneous permission prompts.
- More cancellation/abort handling.
- More failure combinations.

### Completion Check

- Orchestrator can run two independent agents in parallel.
- Orchestrator can run dependent agents sequentially.
- UI shows multiple active nodes.
- Permission prompts remain node-specific.

## Phase 15: Sidebar And Internal Session Cleanup

### Goal

Make the user-facing session list clean and graph-native.

### Changes

Internal node chat sessions should not clutter the normal session list.

Needed behavior:

- Sidebar shows graph sessions.
- Internal node chat sessions are hidden.
- Deleting/archiving a graph session cleans up or archives internal node sessions.
- Forking/exporting/sharing behavior is reviewed for graph sessions.

Possible implementation:

- Mark internal node sessions with metadata.
- Add session list filters.
- Add graph-owned cleanup behavior.

### Why

Without this, every node chat appears as a separate user session, making the app confusing.

### Consequences

Session list APIs and filters must understand graph-owned internal sessions.

### Completion Check

- Sidebar shows only graph sessions.
- Internal node chats do not appear as normal sessions.
- Deleting graph session handles graph nodes and internal chats.

## Phase 16: Capability-Aware Node Settings

### Goal

Make settings adapt to provider/model capabilities.

### Changes

Use provider/model metadata to expose or hide settings:

- Tool calling.
- MCP.
- Image input.
- File input.
- Reasoning controls.
- Subagent spawning.
- Context limits.

### Why

Not every model supports every behavior. Node settings must not imply unsupported capabilities.

### Consequences

Changing provider/model may invalidate some node settings. The UI must handle that clearly.

### Completion Check

- Unsupported settings are hidden or disabled.
- Supported settings are shown.
- Changing provider/model updates available settings.

## Readiness Milestones

### Foundation Ready

The foundation is ready when:

- Graph persistence exists.
- New sessions create default Orchestrator.
- Selected node state exists.
- Chat history displays from selected node.
- Prompt submit sends through selected node.

This is the most important milestone. After this, most graph features can be built on top safely.

### UI Ready

The UI is ready when:

- Graph canvas renders nodes.
- Nodes can be created, moved, resized, selected.
- Node settings panel works.
- Edges can be created and persisted.
- Chat target switching works.

### Runtime Ready

The runtime is ready when:

- Orchestrators can call agents.
- Agent results return to orchestrators.
- Node permissions work independently.
- Same-chat behavior works.
- Sequential and parallel execution work.

## Implementation Rules

- Do not rewrite the existing session engine first.
- Do not make graph UI the source of truth before graph persistence exists.
- Do not route prompts through graph nodes until selected-node chat history works.
- Do not implement multi-agent orchestration before node permissions are understood.
- Keep `graphSessionID` and `nodeChatSessionID` explicit in code.
- Treat internal node sessions as implementation details, not user-facing sessions.
