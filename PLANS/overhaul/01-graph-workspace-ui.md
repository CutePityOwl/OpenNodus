# 01 Graph Workspace UI

## Goal

Replace the current chat-history-centered workspace with a split layout where the center of the session view contains an `xyflow` graph.

The chat composer remains part of the app, but the main session space should no longer be only a message timeline. It should become a visual workspace where orchestrators and agents can be created, moved, connected, selected, and configured.

## Layout

The current area above the chat input, where chat history is displayed, should be split by width.

Initial direction:

- Keep the existing sidebar/navigation structure.
- Keep the chat input/composer at the bottom.
- Replace or split the chat history area with a central graph canvas.
- The graph should be the main visual surface of the session.
- Node settings should open in a right-side panel when needed.

The first implementation can keep a compact message/history panel if needed, but the graph should be treated as the main workspace.

## Graph Canvas

The graph canvas should use `xyflow`.

Required behavior:

- Pan and zoom.
- Right-click context menu.
- Add orchestrator node.
- Add agent node.
- Select nodes.
- Move nodes.
- Resize nodes.
- Link nodes.
- Persist node position and size.
- Persist graph edges.

## Context Menu

Right-clicking on the graph canvas should open a context menu with:

- Add Orchestrator
- Add Agent

When a node is created from the context menu, it should appear at the clicked graph position.

## Linking Nodes

The first interaction model:

1. User selects one node.
2. User selects another node.
3. OpenNodus creates a link between them.

This can later evolve into handle-based linking using `xyflow` edges, but the first version should support simple select-to-link behavior.

The app should clearly show:

- Which node is selected.
- When the user is in linking mode.
- Which nodes can be connected.
- The resulting connection direction.

## Node Visual Design

Each node should communicate its role and status quickly.

Node display should include:

- Node name.
- Node type: Orchestrator or Agent.
- Provider.
- Model.
- Current status.
- Permission state when waiting for approval.
- Small settings icon in the top-right corner.

Nodes should be resizable and movable.

The settings icon should open the Node Settings panel on the right side of the UI.

## Chat Target Selection

The chat input should include a target selector.

Behavior:

- Default target is the first available Orchestrator.
- User can select another orchestrator or agent node.
- Messages are sent to the selected node.
- The UI should make the active chat target visible.

If no orchestrator exists, the app should either:

- Automatically create a default orchestrator for the session.

## Session Creation

The existing "new chat" behavior should become "new session".

Each new session should create a new graph in the same workspace/project folder. This keeps the current OpenCode behavior where the user can create separate conversations in one project, but the conversation unit becomes a graph session instead of a single linear chat.

Default behavior:

- User clicks new chat/new session.
- OpenNodus creates a new graph session.
- The graph starts with one default Orchestrator node.
- The chat target selector defaults to that Orchestrator.

## Per-Node Chat History

Chat history is per node.

The chat target selector should behave like this:

- User selects an Orchestrator or Agent node.
- The visible chat history changes to that node's current chat history.
- If the selected node has existing history, it is shown.
- If the selected node has no current history, the chat appears empty.
- If the selected node has `Same chat` disabled, the chat should be clear for a new interaction.

The chat history area should be draggable and should be possible to show or hide above the chat input.

This means the visible chat is no longer global session history. It is the currently selected node's chat view.

## Open Questions

- Should the draggable chat history default to visible or hidden?
- Should each node show its own local message history inside the node?
- Should linking be directional by default?
- Should node chat history be previewed inside the graph node, or only in the draggable chat panel?
