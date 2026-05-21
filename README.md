# OpenNodus

OpenNodus is a desktop-focused fork of OpenCode.

The project currently keeps the Electron desktop app and the supporting runtime packages needed for the desktop experience. CLI/TUI-oriented pieces and unrelated upstream project infrastructure have been removed or ignored where safe.

## Direction

OpenNodus will evolve OpenCode's single-agent chat interface into a visual multi-agent orchestration workspace.

The planned interface centers on an `xyflow` graph where:

- Orchestrators and agents are represented as nodes.
- Users connect nodes to define workflow relationships.
- Chat targets a selected node.
- Each node can have its own provider, model, instructions, permissions, MCP/tool access, and chat memory behavior.

Implementation plans are tracked in `PLANS/`.

## Desktop Build

Install dependencies:

```bash
bun install
```

Build the Electron desktop app:

```bash
OPENCODE_CHANNEL=dev bun run --cwd packages/desktop build
```

Create a local unpacked Windows desktop build:

```bash
OPENCODE_CHANNEL=dev bun --cwd packages/desktop electron-builder --win --dir --config electron-builder.config.ts
```

On Windows PowerShell:

```powershell
$env:OPENCODE_CHANNEL='dev'; bun run --cwd packages/desktop build
$env:OPENCODE_CHANNEL='dev'; bun --cwd packages/desktop electron-builder --win --dir --config electron-builder.config.ts
```

The local Windows executable is produced under:

```text
packages/desktop/dist/win-unpacked/OpenNodus Dev.exe
```

## Notes

The current local Windows packaging disables executable resource editing to avoid Electron Builder's `winCodeSign` symlink extraction issue on Windows sessions without symlink privileges.

