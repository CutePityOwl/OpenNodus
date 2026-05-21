# 06 Current System Impact

This document records findings from inspecting the current OpenNodus/OpenCode codebase before implementing the graph overhaul.

The important point: the current system is heavily centered around `sessionID`. OpenNodus needs to keep the existing session machinery, but add a graph layer that can manage multiple node-level chats inside one graph session.

## Current Frontend Shape

The current session page is implemented mainly in:

- `packages/app/src/pages/session.tsx`
- `packages/app/src/components/prompt-input/submit.ts`
- `packages/app/src/context/global-sync.tsx`
- `packages/app/src/context/global-sync/event-reducer.ts`
- `packages/app/src/context/global-sync/types.ts`

Current behavior:

- Route is `/session/:id?`.
- `params.id` is treated as the active session ID.
- The message timeline reads from `sync.data.message[params.id]`.
- The composer sends prompts directly to `client.session.promptAsync({ sessionID })`.
- New chat creates a new backend session.
- Busy state, permissions, questions, todos, diffs, and message caches are keyed by `sessionID`.

## Current Backend Shape

The current backend session API is implemented mainly in:

- `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`
- `packages/opencode/src/session/session.ts`
- `packages/opencode/src/session/session.sql.ts`
- `packages/opencode/src/session/schema.ts`

Current behavior:

- `SessionTable` stores one row per session.
- `MessageTable`, `PartTable`, `TodoTable`, and permission events are keyed by `session_id`.
- Session create/list/update/remove/prompt/abort/revert all operate on one `sessionID`.
- Permission updates currently attach to the session.
- Event reducer receives events like `session.created`, `message.updated`, `permission.asked`, and stores them by `sessionID`.

## Main Compatibility Issue

OpenNodus wants:

- One graph session visible in the sidebar/session list.
- Multiple nodes inside that graph.
- Each node having its own chat/context.
- Chat target selection switching visible history to the selected node.
- Node-specific permissions.
- Orchestrator-to-agent calls that may reuse or create node chats depending on `Same chat`.

The current system gives:

- One session ID.
- One message stream per session.
- One permission bucket per session.
- One active prompt target per session.

This means OpenNodus should not simply replace `sessionID` everywhere with `nodeID`. It needs a mapping layer.

## Recommended Data Model Direction

Keep the existing backend session as the graph session.

Add graph-specific records:

- Graph session data keyed by the existing `sessionID`.
- Node records keyed by `nodeID`.
- Edge records keyed by `edgeID`.
- Node chat references that point to existing or new internal session IDs.

Suggested relationship:

```text
Graph Session
  id: sessionID
  graph:
    nodes:
      nodeID -> node settings
      nodeID -> current chat sessionID
    edges:
      edgeID -> source nodeID / target nodeID
```

This lets OpenNodus reuse the existing message, permission, event, prompt, and provider systems for node-level chats while presenting only the graph session as the user-facing session.

## Same Chat Mapping

The `Same chat` setting should decide which internal session ID is used when a node is called.

When enabled:

- The node keeps a persistent `currentChatSessionID`.
- Calls to that node reuse that internal session.
- Multiple orchestrators calling the same agent reuse that agent's chat if the agent has `Same chat` enabled.

When disabled:

- Each call creates a new internal session for that node.
- The visible node chat may show the latest fresh chat, or a selected run-specific chat.

This needs an explicit implementation decision later.

## Frontend Implementation Impact

The session page needs to stop assuming `params.id` is also the message timeline source.

Instead:

- `params.id` should identify the graph session.
- The selected node should identify the visible node chat.
- `MessageTimeline` should receive messages from the selected node's chat session ID.
- The prompt submit path should send to the selected node, not directly to the graph session.
- New session creation should create the graph session and default Orchestrator node.

Likely first frontend steps:

1. Add graph state to the session page.
2. Add selected node state.
3. Render a graph canvas above or instead of the current timeline.
4. Add a draggable/hideable node chat history panel.
5. Change prompt submit to resolve the selected node before sending.

## Backend Implementation Impact

The backend needs a graph API or graph service.

Possible new API groups:

- `graph.get(sessionID)`
- `graph.update(sessionID)`
- `graph.node.create(sessionID)`
- `graph.node.update(sessionID, nodeID)`
- `graph.node.delete(sessionID, nodeID)`
- `graph.edge.create(sessionID)`
- `graph.edge.delete(sessionID, edgeID)`
- `graph.node.prompt(sessionID, nodeID)`
- `graph.node.messages(sessionID, nodeID)`

The existing session prompt API can still be used internally, but the frontend should eventually talk to graph/node APIs.

## Permissions Impact

Current permission state is session-keyed.

For node-specific permissions, requests need node identity.

Options:

1. Store permissions on each internal node chat session.
2. Add node metadata to permission requests.
3. Add a graph permission layer that maps permission requests back to nodes.

The least disruptive first path is likely:

- Use one internal session per node chat.
- Store node permissions as that internal session's permission ruleset.
- Add UI metadata so the permission prompt shows the node name/type/provider/model.

## Event And Sync Impact

Current frontend sync state is keyed by session ID:

- `message[sessionID]`
- `permission[sessionID]`
- `question[sessionID]`
- `todo[sessionID]`
- `session_status[sessionID]`

If node chats use internal session IDs, the event system can keep working with fewer changes.

The graph layer then maps:

- Graph session ID -> graph nodes
- Node ID -> internal session ID
- Internal session events -> visible node status/history

This is less invasive than rewriting the event system to be node-native immediately.

## Key Risks

- The sidebar currently lists backend sessions. Internal node sessions must not clutter the user-facing session list.
- Archiving/deleting a graph session must also clean up its node chat sessions.
- Current root/child session behavior may conflict with graph-owned internal sessions.
- The prompt composer currently reads provider/model/agent from local UI state, not from node settings.
- Message history paging currently assumes the visible session is `params.id`.
- Permission auto-accept currently uses session ID and directory; node-level auto-accept needs stricter scoping.

## Recommended First Implementation Slice

Start with a minimal compatibility layer:

1. Keep `params.id` as the graph session ID.
2. Add graph data stored separately and keyed by `params.id`.
3. Create one default Orchestrator node for new sessions.
4. Give that Orchestrator one internal chat session.
5. Route chat display and prompt submit through selected node's internal session ID.
6. Only after that works, add multiple nodes and edges.

This preserves the current working session engine while gradually moving the product model toward graph orchestration.

