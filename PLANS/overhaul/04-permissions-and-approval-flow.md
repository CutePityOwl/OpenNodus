# 04 Permissions And Approval Flow

## Goal

OpenCode currently has a permission approval flow inside a session. OpenNodus needs to split that behavior by node.

Each orchestrator and agent must have its own permission state and approval requirements.

## Node-Level Permissions

Every node should have its own permission policy.

This means:

- An orchestrator can be allowed to use a tool while an agent is not.
- One agent can have MCP access while another does not.
- One model can be allowed to spawn provider-supported AI agents while another cannot.
- Approval history should identify which node requested the action.
- Default permissions should also be node-specific.

## Permission Requests

Permission prompts should show:

- Requesting node name.
- Node type.
- Provider/model.
- Requested action.
- Tool or MCP server involved.
- Risk level or action category if available.
- Whether approval applies once, always for this node, or always for this workflow.

The existing permission UI can be reused, but it needs node context.

## Approval Scope

Approval should support clear scopes.

Possible scopes:

- Approve once.
- Approve for this node.
- Approve for this node and this tool.
- Approve for this workflow.
- Deny once.
- Deny for this node.

The first implementation can start with simple approve/deny per request, then expand scope controls later.

## Independent Node Permissions

Permissions should not silently transfer between nodes.

Example:

- Orchestrator A is allowed to edit files.
- Agent B is connected to Orchestrator A.
- Agent B should still need its own approval before editing files unless the user explicitly gives shared workflow permission.

This is important because agents may use different providers, instructions, or trust levels.

## UI Behavior

When a node is waiting for permission:

- The node should show a waiting state.
- The graph should visually identify the node requesting approval.
- The permission prompt should include the node identity.
- The chat/session area should not make the request look like it came from the wrong node.

## Auditability

The app should record permission events with node identity.

Useful fields:

- Node ID.
- Node name.
- Node type.
- Provider.
- Model.
- Requested action.
- User decision.
- Timestamp.
- Scope of approval.

## Open Questions

- Should permissions live in session state, node state, or a separate permission store?
- Approval scopes should not be inherited across connected nodes unless a later explicit workflow-level permission system is designed.
- Should orchestrators be allowed to grant permissions to agents, or only the user?
- Should there be a global emergency stop for all running nodes?
