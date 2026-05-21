# OpenNodus Overhaul Plan

This plan describes the main product and technical overhaul needed to turn OpenNodus from a single-agent chat application into a visual multi-agent orchestration workspace.

OpenNodus starts from OpenCode's existing Electron desktop app, provider system, tools, MCP support, sessions, permissions, and agent runtime. The overhaul should preserve the working foundation while changing how users compose and control AI agents.

## Core Product Change

The current OpenCode experience is centered around a linear chat session.

OpenNodus should become graph-centered:

- The main workspace contains an `xyflow` graph.
- Orchestrators and agents are represented as nodes.
- Users connect nodes to define how work flows between them.
- Chat still exists, but messages are directed to a selected graph node.
- Each node has its own model/provider configuration, permissions, instructions, and execution behavior.
- A new session creates a new graph inside the same workspace/project folder.
- New sessions should automatically start with a default Orchestrator node.

## Plan Documents

- [00 Master Implementation Plan](./00-master-implementation-plan.md)
- [01 Graph Workspace UI](./01-graph-workspace-ui.md)
- [02 Node Model And Settings](./02-node-model-and-settings.md)
- [03 Runtime And Message Flow](./03-runtime-and-message-flow.md)
- [04 Permissions And Approval Flow](./04-permissions-and-approval-flow.md)
- [05 Backend And API Impact](./05-backend-and-api-impact.md)
- [06 Current System Impact](./06-current-system-impact.md)

## Guiding Principle

The graph should become the primary representation of an AI workflow. Chat becomes one way to interact with a node, not the only structure of the session.
