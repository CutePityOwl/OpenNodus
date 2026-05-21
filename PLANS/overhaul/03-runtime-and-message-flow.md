# 03 Runtime And Message Flow

## Goal

Define how user messages, orchestrators, agents, tools, MCP, and responses move through the graph.

OpenNodus should keep the existing OpenCode runtime where useful, but add a graph execution layer above it.

## Basic Message Flow

Initial flow:

1. User selects a target node in chat.
2. If no node is selected, the first available Orchestrator is selected by default.
3. User sends a message.
4. The selected node receives the message.
5. If the selected node is an orchestrator, it can delegate work to connected agents.
6. The program routes requests from orchestrator to agents.
7. Agents execute their tasks using their own model/provider/settings.
8. Final agent results are returned to the orchestrator.
9. The orchestrator decides the final response.
10. The final response is shown to the user.

## Orchestrator Communication

The orchestrator should communicate with the program, not directly mutate other nodes.

The program should be responsible for:

- Validating graph links.
- Routing messages.
- Enforcing permissions.
- Passing context.
- Running tools.
- Calling MCP.
- Capturing logs and history.
- Returning agent results.

This keeps orchestration observable and controllable.

## Agent Communication

Agents can receive tasks from:

- Orchestrators.
- The user, if the chat target is set directly to an agent.

For the first version, agent-to-agent calls should not be part of execution. The graph may allow cycles and visual connections for now, but runtime task routing should start with Orchestrator to Agent.

## Graph Edges

Edges define allowed communication paths.

Potential edge rules:

- Orchestrator to Agent: allowed.
- Agent to Orchestrator: allowed for returning results.
- Agent to Agent: allowed visually for now, but not used for runtime execution in the first version.
- Orchestrator to Orchestrator: possible later, but not required in the first version.

The first version should keep rules simple and explicit.

Cycles are allowed for now. The runtime must still avoid uncontrolled loops by making orchestration decisions explicit.

## Context Handling

The orchestrator has the broadest context.

Agents should receive limited context by default:

- The assigned task.
- Relevant files or snippets.
- Specific instructions.
- Any context the orchestrator intentionally passes.

This avoids every agent automatically receiving the full session history.

## Same Chat Behavior

Each node has a `Same chat` setting that controls whether repeated calls reuse prior context.

When `Same chat` is enabled:

- The runtime should look for an existing chat/context for that node.
- If one exists, the new request should continue from it.
- If none exists, the runtime should create the first chat/context for that node and reuse it on later calls.
- This allows the node to keep memory across multiple orchestrator calls or agent-to-agent calls.
- The reused chat belongs to the target node, not to the caller.

Example:

- Orchestrator A and Orchestrator B are both connected to Agent X.
- Agent X has `Same chat` enabled.
- When either orchestrator calls Agent X, Agent X resumes its own existing chat/context.
- Orchestrator A and Orchestrator B still keep their own separate chats.

When `Same chat` is disabled:

- The runtime should create a new chat/context every time the node is called.
- The call should not automatically inherit the node's previous execution history.
- Only explicitly passed context should be included.

This setting affects both orchestrators and agents.

The runtime must still enforce provider context limits. Reusing the same chat should not mean blindly sending unlimited history if the model cannot handle it.

## Provider-Spawned Agents

OpenCode already supports provider/model features where capable models can spawn additional AI agents.

OpenNodus should distinguish these from graph nodes:

- Graph nodes are user-visible workspace entities.
- Provider-spawned agents are internal runtime helpers.

A graph node may be allowed to spawn provider-supported AI agents, but those spawned agents should not automatically become graph nodes.

## Execution State

Each node should expose runtime state.

Possible states:

- Idle.
- Thinking.
- Waiting for permission.
- Running tool.
- Waiting for MCP.
- Delegating.
- Receiving result.
- Error.
- Complete.

The graph UI should reflect these states visually.

## Result Visibility

Orchestrators should receive final agent results, not the full internal agent transcript.

The first version should treat agent execution details as node-local history. The orchestrator gets the useful result or failure result needed to continue the workflow.

This avoids leaking every agent's full internal process into the orchestrator context by default.

## Failure Behavior

If an agent fails, the failure should be returned to the orchestrator as a result.

The orchestrator can then decide whether to:

- Retry the same agent.
- Call another agent.
- Adjust the prompt.
- Ask the user for help.
- Stop the workflow.

The app should not automatically hide agent failure. It should become part of the orchestrator's decision context.

## Sequential And Parallel Calls

An orchestrator must be able to call agents sequentially or in parallel.

This is a core behavior.

Sequential calls are needed when one agent's output should shape another agent's task.

Example:

- Agent UI Designer is called first.
- The orchestrator receives the design output.
- The orchestrator then calls Agent UI Coder with either the original prompt plus the design result, or a new prompt created from the design result.

Parallel calls are useful when agents can work independently.

Example:

- Agent Researcher and Agent Risk Reviewer can inspect different aspects of the same task at the same time.
- The orchestrator receives both results and combines them.

The orchestrator should decide whether calls are sequential or parallel based on the task and graph structure.

## Open Questions

- Should graph execution be event-streamed to the UI through the existing session event system?
- Should every node have its own local transcript?
- Should orchestrator delegation be represented as messages, tasks, or both?
- Should a graph run be resumable after app restart?
- Should `Same chat` history be trimmed by the existing context management system or by a node-specific policy?
- How should the orchestrator express whether connected agents should run sequentially or in parallel?
