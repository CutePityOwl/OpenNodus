# 02 Node Model And Settings

## Goal

Each graph node should represent an independently configurable AI participant.

The node settings system must support both shared settings and provider/model-specific settings.

## Node Types

OpenNodus has two primary node types.

## Orchestrator

The orchestrator is responsible for managing workflow context and delegating work.

Expected behavior:

- Has full context of the workflow.
- Receives user messages by default.
- Coordinates connected agents.
- Sends tasks to agents.
- Receives agent results.
- Decides what to return to the user.
- Can use tools and MCP when configured.
- Can optionally spawn provider-supported AI subagents.

## Agent

An agent is responsible for focused work.

Expected behavior:

- Receives work from an orchestrator or connected agent.
- Can have a different provider/model from other nodes.
- Can have independent instructions.
- Can have independent tool and MCP access.
- Can optionally spawn provider-supported AI subagents if the provider/model supports it and the node setting allows it.

## Node Settings Panel

Selecting the settings icon on a node should open a right-side Node Settings panel.

Settings should include:

- Node name.
- Node type.
- Provider.
- Model.
- Instructions.
- Permissions policy.
- MCP access.
- Tool access.
- Whether the node can spawn provider-supported AI subagents.
- Same chat behavior.
- Context policy.
- Memory/session behavior.

Some settings should change depending on provider and model capability.

For example:

- A model that supports tool use can expose tool settings.
- A model that supports MCP can expose MCP settings.
- A model that supports subagent spawning can expose spawn settings.
- A model without a feature should show the setting as unavailable or hide it.

## Node Data Model

Each node needs persistent data.

Suggested fields:

```ts
type OpenNodusNode = {
  id: string
  type: "orchestrator" | "agent"
  name: string
  providerID: string
  modelID: string
  instructions: string
  position: { x: number; y: number }
  size: { width: number; height: number }
  permissions: NodePermissionPolicy
  tools: NodeToolPolicy
  mcp: NodeMcpPolicy
  canSpawnAgents: boolean
  sameChat: boolean
  contextPolicy: NodeContextPolicy
}
```

This type is only a planning shape. The final implementation should follow the existing OpenCode data and session patterns where possible.

## Provider Capability Awareness

Node settings should be capability-aware.

The settings panel should not assume every provider/model supports the same features.

Required capability categories:

- Text generation.
- Tool calling.
- MCP usage.
- Image input.
- File input.
- Reasoning controls.
- Subagent spawning.
- Context window size.

## Same Chat Setting

Each orchestrator and agent node should have a `Same chat` setting.

This setting controls whether a node reuses its previous chat/context when it is called again.

When `Same chat` is enabled:

- The node should reuse an existing chat/context if one already exists.
- Previous iterations remain available to the node.
- The node can build memory through repeated calls.
- This is useful for long-running specialists, recurring agents, and orchestrators that need continuity.

When `Same chat` is disabled:

- Each call to the node should start a new chat/context.
- Previous calls should not automatically affect the new request.
- This is useful for isolated tasks, clean reviews, independent checks, and avoiding stale context.

The setting applies to both orchestrators and agents.

The UI should make this behavior clear because it changes how much memory a node has between calls.

## Open Questions

- Should node settings be stored inside the existing session data or a new graph workspace table?
- Should orchestrator and agent use the same base node schema?
- Should node instructions extend or replace provider/model default instructions?
- Should changing provider/model reset unsupported settings?
- Should `Same chat` reuse one chat per node, one chat per edge, or one chat per calling node and target node pair?
