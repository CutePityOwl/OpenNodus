# OpenNodus

![OpenNodus preview](preview.png)

OpenNodus is a desktop-focused fork of OpenCode that turns agent work into a visual node graph.

Instead of working with a single chat target, OpenNodus is being shaped around graph-based AI orchestration: orchestrators and agents live as connected nodes, each with its own model, provider, instructions, permissions, tools, MCP rules, and chat memory behavior.

## Features

- Desktop-first Electron app for Windows, macOS, and Linux.
- Visual node graph built into the session workspace.
- Orchestrator and Agent node types.
- Drag-to-connect node linking with floating graph edges.
- Per-node provider, model, reasoning, instruction, and permission settings.
- Per-node chat targeting from the composer.
- Same-chat memory mode, with reset controls for node chat context.
- Node actions for detach, clone, and delete.
- MCP/tool policy groundwork for node-specific agent execution.

## Status

OpenNodus is an active fork in early overhaul. The desktop app builds and runs, while the multi-agent graph system is being expanded incrementally on top of OpenCode's runtime.

## Build

Install dependencies:

```bash
bun install
```

Build the desktop app:

```bash
OPENCODE_CHANNEL=dev bun run --cwd packages/desktop build
```

Windows PowerShell:

```powershell
$env:OPENCODE_CHANNEL='dev'; bun run --cwd packages/desktop build
```

Create an unpacked Windows build:

```powershell
$env:OPENCODE_CHANNEL='dev'; bun --cwd packages/desktop electron-builder --win --dir --config electron-builder.config.ts
```

The local Windows executable is produced under:

```text
packages/desktop/dist/win-unpacked/OpenNodus Dev.exe
```

## Credits

OpenNodus is based on OpenCode and keeps the desktop app/runtime foundation while exploring a graph-first multi-agent workflow.
