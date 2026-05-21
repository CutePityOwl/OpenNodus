# OpenNodus Fork Direction

OpenNodus is a fork of OpenCode focused on the desktop Electron app.

OpenCode is an AI coding application for working with agents from different model providers. It already supports multiple providers, integrated tools, MCP servers, and provider-specific model capabilities. OpenNodus keeps that foundation, but changes the main interaction model.

## Core Difference

OpenCode is centered around chatting with a single active agent in a linear conversation.

OpenNodus will move toward a graph-based workspace. Instead of the chat history being the main center of the app, that space will become an `xyflow` graph. The graph will contain nodes, and each node represents an AI participant in the workflow.

## Node Types

OpenNodus will have two primary node types:

1. **Orchestrator**
   - Has the full context of the workflow.
   - Coordinates work across connected agents.
   - Decides how tasks should be delegated.
   - Can use tools and MCP when available.

2. **Agent**
   - Handles specific tasks assigned by an orchestrator or another connected agent.
   - Can use the same or a different model/provider from other nodes.
   - May have its own tools or MCP access depending on provider support and configuration.

## Graph Workflow

Orchestrators and agents are added to the canvas as graph nodes. They can then be connected using `xyflow`'s built-in linking system.

Supported relationships may include:

- Agent to orchestrator
- Orchestrator to agent
- Agent to agent

These links define how context, requests, results, and responsibilities move through the workflow.

## Agents and Provider Capabilities

Each node can represent either the same model/provider or a different one. For example, a graph could contain an orchestrator backed by one model and several agents backed by Claude, ChatGPT, DeepSeek, or other providers.

OpenCode already has support for provider/model-specific features, including the ability for capable models to spawn additional AI agents. OpenNodus should preserve that behavior.

There is an important distinction:

- **Graph agents** are visible nodes in the OpenNodus workspace.
- **Spawned AI agents** are provider/model-level helper agents created during execution, not visible graph nodes by default.

This means an orchestrator node or an agent node may still use provider-supported agent spawning internally, while the main user-facing structure remains the `xyflow` graph.

## Goal

The goal of OpenNodus is to turn OpenCode from a single-agent chat interface into a visual multi-agent orchestration workspace.

The desktop app should allow users to design, connect, and run AI workflows where different agents can specialize, collaborate, use MCP/tools, and pass work through a graph structure.
