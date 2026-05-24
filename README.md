<p align="center">
  <img src="./preview.png" alt="OpenNodus preview" width="100%">
</p>

# OpenNodus

OpenNodus is a desktop-first fork of [OpenCode](https://github.com/anomalyco/opencode) focused on graph-based AI agent orchestration.

Instead of treating a workspace as one chat with one active model, OpenNodus turns each session into a node graph. Orchestrator nodes receive user requests, inspect the workspace, and delegate implementation work to connected Agent nodes. Agent nodes can use their own provider, model, instructions, permissions, tools, MCP access, and chat memory.

OpenNodus is not affiliated with, endorsed by, or maintained by the OpenCode team.

## Core Idea

Each workspace can contain multiple sessions. Each session owns its own graph.

- **Orchestrator nodes** coordinate the work. They can read, search, reason, plan, and call connected agents.
- **Agent nodes** perform delegated work. They can code, edit files, use tools, call MCP servers, and return results to the orchestrator.
- **Edges** connect orchestrators and agents. A connected agent becomes available to the orchestrator through the graph delegation tool.
- **Node chats** are separate. Selecting a node switches the visible chat/history to that node.
- **Same chat** controls memory reuse. When enabled, repeated calls to a node reuse that node's current chat. When disabled, calls start from a fresh context.

The graph is part of the session state, so creating a new session creates a new graph inside the same workspace.

## Delegation Model

OpenNodus uses OpenCode's runtime as its foundation, but adds graph context and node-aware tool rules.

1. The user sends a message to the selected node, usually the first orchestrator.
2. The orchestrator receives dynamic graph context describing connected agents and how to call them.
3. When agents are connected, the orchestrator is expected to delegate file-changing work through the `graph_agent` tool.
4. The selected agent runs with its own model, provider, permissions, tools, MCP policy, and chat-memory setting.
5. The agent result is returned to the orchestrator with a workspace-change summary when available.
6. The orchestrator responds to the user with the useful final result, not the full internal agent transcript.

When an orchestrator has connected agents, mutation tools such as direct patch/write/edit tools are filtered away from the orchestrator. This keeps the orchestrator focused on coordination and keeps implementation work inside the agent nodes. If an orchestrator has no connected agents, it can still operate like a normal OpenCode-style coding assistant.

## Node Settings

Each node can be configured independently.

- Node name and role
- Provider and model
- Reasoning/thinking mode where supported
- Custom instructions
- Tool and MCP policies
- Permission defaults
- Same chat memory behavior
- Agent spawning policy

Permissions are node-scoped. Two agents can use the same MCP server or tool with different approval rules.

## Desktop App

OpenNodus currently targets the desktop app. The terminal/TUI side of OpenCode is not the focus of this fork.

The desktop graph UI includes:

- Orchestrator and Agent node creation
- Easy node-to-node connection
- Node clone, detach, and delete actions
- Per-node settings panel
- Chat target selector
- Context panel with node-specific usage information
- Configurable edge style

## Development

OpenNodus uses Bun and Electron.

Install dependencies:

```bash
bun install
```

Run the desktop app in development mode:

```bash
bun --cwd packages/desktop dev
```

Typecheck the app package:

```bash
bun --cwd packages/app typecheck
```

Build the desktop bundle:

```bash
bun --cwd packages/desktop build
```

## Packaging

The package scripts rebuild the desktop bundle before packaging, so packaged apps include the latest server and UI changes.

Package for the current platform:

```bash
bun --cwd packages/desktop package
```

Package for Windows:

```bash
bun --cwd packages/desktop package:win
```

Package for macOS:

```bash
bun --cwd packages/desktop package:mac
```

Package for Linux:

```bash
bun --cwd packages/desktop package:linux
```

Development-channel builds use the dev app identity and may produce names such as `OpenNodus Dev`. Production-channel builds use the production app identity.

On Unix shells:

```bash
OPENCODE_CHANNEL=prod bun --cwd packages/desktop package
```

On PowerShell:

```powershell
$env:OPENCODE_CHANNEL = "prod"
bun --cwd packages/desktop package
```

## Debugging

Development builds write OpenNodus LLM request debug dumps under the app data directory. These dumps are useful for verifying which system prompts, messages, and tools were sent to the model.

Windows dev path:

```text
%APPDATA%\ai.opennodus.desktop.dev\opencode\opennodus-debug\llm
```

macOS and Linux use the equivalent Electron app data location for the dev app identity.

## Status

OpenNodus is in active early development. The desktop app builds and runs, and the graph workflow is being expanded incrementally on top of OpenCode's runtime.

## License

MIT
