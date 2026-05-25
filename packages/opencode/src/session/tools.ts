import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Tool } from "@/tool/tool"
import { ToolJsonSchema } from "@/tool/json-schema"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { ModelID } from "@/provider/schema"
import { Plugin } from "@/plugin"
import { Graph } from "@/graph/graph"
import { formatWorkspaceChanges } from "@/graph/workspace-changes"
import { Snapshot } from "@/snapshot"
import type { TaskPromptOps } from "@/tool/task"
import { type Tool as AITool, tool, jsonSchema, type ToolExecutionOptions, asSchema } from "ai"
import { Cause, Effect, Exit, Option } from "effect"
import { MessageV2 } from "./message-v2"
import * as Session from "./session"
import { SessionProcessor } from "./processor"
import { MessageID, PartID } from "./schema"
import * as Log from "@opencode-ai/core/util/log"
import { EffectBridge } from "@/effect/bridge"
import { findExclusiveMcpParallelConflict } from "./graph-agent-mcp-scheduler"

const log = Log.create({ service: "session.tools" })
const ORCHESTRATOR_BLOCKED_TOOLS = new Set(["edit", "write", "apply_patch", "patch"])
const ORCHESTRATOR_BLOCKED_PERMISSIONS = new Set(["edit", "write", "apply_patch", "patch"])
const ORCHESTRATOR_DELEGATION_MESSAGE =
  "This Orchestrator has connected Agent nodes, so it cannot perform direct workspace changes. Delegate this work with graph_agent to a suitable connected Agent node."

export const resolve = Effect.fn("SessionTools.resolve")(function* (input: {
  agent: Agent.Info
  model: Provider.Model
  session: Session.Info
  processor: Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">
  bypassAgentCheck: boolean
  messages: MessageV2.WithParts[]
  promptOps: TaskPromptOps
}) {
  using _ = log.time("resolveTools")
  const tools: Record<string, AITool> = {}
  const run = yield* EffectBridge.make()
  const plugin = yield* Plugin.Service
  const permission = yield* Permission.Service
  const registry = yield* ToolRegistry.Service
  const mcp = yield* MCP.Service
  const truncate = yield* Truncate.Service
  const graph = yield* Graph.Service
  const sessions = yield* Session.Service
  const snapshot = yield* Snapshot.Service
  const graphContext = yield* graph.findNodeByChatSessionID(input.session.id).pipe(Effect.option)
  const isOrchestratorNode = Option.isSome(graphContext) && graphContext.value.node.type === "orchestrator"
  const connectedAgents = (info: Graph.Info, node: Graph.Node) =>
    info.edges
      .filter((edge) => edge.sourceNodeID === node.id || edge.targetNodeID === node.id)
      .map((edge) =>
        info.nodes.find((item) => item.id === (edge.sourceNodeID === node.id ? edge.targetNodeID : edge.sourceNodeID)),
      )
      .filter((item): item is Graph.Node => !!item && item.type === "agent")

  const connectedGraphAgents = isOrchestratorNode ? connectedAgents(graphContext.value.graph, graphContext.value.node) : []
  const graphAgents = Option.isSome(graphContext)
    ? graphContext.value.graph.nodes.filter((node) => node.type === "agent")
    : []
  const delegateTargets = connectedGraphAgents.length > 0 ? connectedGraphAgents : graphAgents
  const shouldDelegateWorkspaceChanges = isOrchestratorNode && delegateTargets.length > 0
  const enforceOrchestratorDelegation = () => {
    if (!shouldDelegateWorkspaceChanges) return
    for (const blocked of ORCHESTRATOR_BLOCKED_TOOLS) {
      delete tools[blocked]
    }
  }

  const context = (args: Record<string, unknown>, options: ToolExecutionOptions): Tool.Context => ({
    sessionID: input.session.id,
    abort: options.abortSignal!,
    messageID: input.processor.message.id,
    callID: options.toolCallId,
    extra: { model: input.model, bypassAgentCheck: input.bypassAgentCheck, promptOps: input.promptOps },
    agent: input.agent.name,
    messages: input.messages,
    metadata: (val) =>
      input.processor.updateToolCall(options.toolCallId, (match) => {
        if (!["running", "pending"].includes(match.state.status)) return match
        return {
          ...match,
          state: {
            title: val.title,
            metadata: val.metadata,
            status: "running",
            input: args,
            time: { start: Date.now() },
          },
        }
      }),
    ask: (req) => {
      if (shouldDelegateWorkspaceChanges && ORCHESTRATOR_BLOCKED_PERMISSIONS.has(req.permission)) {
        return Effect.die(new Error(ORCHESTRATOR_DELEGATION_MESSAGE))
      }
      return permission
        .ask({
          ...req,
          sessionID: input.session.id,
          tool: { messageID: input.processor.message.id, callID: options.toolCallId },
          ruleset: Permission.merge(input.agent.permission, input.session.permission ?? []),
        })
        .pipe(Effect.orDie)
    },
  })

  for (const item of yield* registry.tools({
    modelID: ModelID.make(input.model.api.id),
    providerID: input.model.providerID,
    agent: input.agent,
  })) {
    if (shouldDelegateWorkspaceChanges && ORCHESTRATOR_BLOCKED_TOOLS.has(item.id)) continue

    const schema = ProviderTransform.schema(input.model, ToolJsonSchema.fromTool(item))
    tools[item.id] = tool({
      description: item.description,
      inputSchema: jsonSchema(schema),
      execute(args, options) {
        return run.promise(
          Effect.gen(function* () {
            const ctx = context(args, options)
            yield* plugin.trigger(
              "tool.execute.before",
              { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID },
              { args },
            )
            const result = yield* item.execute(args, ctx)
            const output = {
              ...result,
              attachments: result.attachments?.map((attachment) => ({
                ...attachment,
                id: PartID.ascending(),
                sessionID: ctx.sessionID,
                messageID: input.processor.message.id,
              })),
            }
            yield* plugin.trigger(
              "tool.execute.after",
              { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID, args },
              output,
            )
            if (options.abortSignal?.aborted) {
              yield* input.processor.completeToolCall(options.toolCallId, output)
            }
            return output
          }),
        )
      },
    })
  }

  if (Option.isSome(graphContext) && graphContext.value.node.type === "orchestrator") {
    const connected = delegateTargets

    if (connected.length > 0) {
      const describeConnected = connected
        .map((node) => {
          const model = node.providerID && node.modelID ? `${node.providerID}/${node.modelID}` : "session default"
          return `- ${node.name} (${node.id}, ${model})`
        })
        .join("\n")

      tools.graph_agent = tool({
        description: [
          "Call one or more connected OpenNodus Agent nodes and return only the agents' final results.",
          "Use this for work that should be delegated through the graph rather than handled by this Orchestrator directly.",
          "When delegating implementation or file changes, instruct the Agent to perform the workspace change itself. Do not ask the Agent to merely draft code for the Orchestrator to write or patch afterward.",
          "For multiple independent agents, pass calls with mode=parallel. For dependent work, pass calls with mode=sequential or call this tool again after reading the prior result.",
          "Connected agents:",
          describeConnected,
        ].join("\n"),
        inputSchema: jsonSchema({
          type: "object",
          additionalProperties: false,
          properties: {
            agent_node_id: {
              type: "string",
              description: "The exact graph node id of the connected Agent to call.",
            },
            agent_name: {
              type: "string",
              description: "The connected Agent node name to call when the node id is not known.",
            },
            prompt: {
              type: "string",
              description: "The task prompt to send to the Agent node when making a single call.",
            },
            mode: {
              type: "string",
              enum: ["parallel", "sequential"],
              description:
                "How to execute calls when using the calls array. Defaults to parallel for multiple calls and sequential for a single call.",
            },
            calls: {
              type: "array",
              description: "Batch of Agent node calls to run sequentially or in parallel.",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  agent_node_id: {
                    type: "string",
                    description: "The exact graph node id of the connected Agent to call.",
                  },
                  agent_name: {
                    type: "string",
                    description: "The connected Agent node name to call when the node id is not known.",
                  },
                  prompt: {
                    type: "string",
                    description: "The task prompt to send to this Agent node.",
                  },
                },
                required: ["prompt"],
              },
              minItems: 1,
            },
          },
        }),
        execute(args, options) {
          return run.promise(
            Effect.gen(function* () {
              const params = args as Record<string, unknown>
              const ctx = context(args, options)

              type GraphAgentCall = {
                agent_node_id?: string
                agent_name?: string
                prompt: string
              }
              type PlannedGraphAgentCall = GraphAgentCall & {
                index: number
                target: Graph.Node
              }
              type GraphAgentCallResult = {
                target: Graph.Node
                sessionID?: string
                status: "completed" | "error"
                output: string
                workspaceChanges?: string
              }

              const normalizeCalls = () => {
                const calls = Array.isArray(params.calls)
                  ? params.calls.map((item, index) => {
                      if (!item || typeof item !== "object") {
                        throw new Error(`graph_agent calls[${index}] must be an object`)
                      }
                      const raw = item as Record<string, unknown>
                      const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : ""
                      if (!prompt) throw new Error(`graph_agent calls[${index}] requires a non-empty prompt`)
                      return {
                        agent_node_id: typeof raw.agent_node_id === "string" ? raw.agent_node_id : undefined,
                        agent_name: typeof raw.agent_name === "string" ? raw.agent_name : undefined,
                        prompt,
                      } satisfies GraphAgentCall
                    })
                  : []

                if (calls.length > 0) return calls

                const prompt = typeof params.prompt === "string" ? params.prompt.trim() : ""
                if (!prompt) throw new Error("graph_agent requires a non-empty prompt or calls array")
                return [
                  {
                    agent_node_id: typeof params.agent_node_id === "string" ? params.agent_node_id : undefined,
                    agent_name: typeof params.agent_name === "string" ? params.agent_name : undefined,
                    prompt,
                  },
                ] satisfies GraphAgentCall[]
              }

              const selectTarget = (call: GraphAgentCall, targets: Graph.Node[]) => {
                const matches = targets.filter(
                  (node) =>
                    (call.agent_node_id && node.id === call.agent_node_id) ||
                    (call.agent_name && node.name === call.agent_name),
                )
                const target =
                  matches.length === 1
                    ? matches[0]
                    : !call.agent_node_id && !call.agent_name && targets.length === 1
                      ? targets[0]
                      : undefined

                if (!target) {
                  const available = targets.map((node) => `${node.name} (${node.id})`).join(", ") || "none"
                  throw new Error(`Select exactly one connected Agent node. Available: ${available}`)
                }
                return target
              }

              const formatResult = (result: GraphAgentCallResult) => {
                const tag = result.status === "completed" ? "agent_result" : "agent_error"
                return [
                  `<${tag} node="${result.target.name}" node_id="${result.target.id}">`,
                  result.output,
                  result.workspaceChanges ? `\n${result.workspaceChanges}` : undefined,
                  `</${tag}>`,
                ]
                  .filter((line): line is string => !!line)
                  .join("\n")
              }

              const current = yield* graph.findNodeByChatSessionID(ctx.sessionID)
              if (current.node.type !== "orchestrator") {
                return yield* Effect.fail(new Error("graph_agent can only be used by Orchestrator nodes"))
              }

              const fresh = yield* graph.get(current.node.graphSessionID)
              const targets = connectedAgents(fresh, current.node)

              const calls = normalizeCalls()
              const mode =
                params.mode === "sequential" || params.mode === "parallel"
                  ? params.mode
                  : calls.length > 1
                    ? "parallel"
                    : "sequential"
              const planned = calls.map((call, index) => ({
                ...call,
                index,
                target: selectTarget(call, targets),
              })) satisfies PlannedGraphAgentCall[]

              if (mode === "parallel") {
                const targetCounts = new Map<string, number>()
                for (const call of planned) {
                  targetCounts.set(call.target.id, (targetCounts.get(call.target.id) ?? 0) + 1)
                }
                const duplicate = planned.find((call) => (targetCounts.get(call.target.id) ?? 0) > 1)
                if (duplicate) {
                  return yield* Effect.fail(
                    new Error(
                      `Parallel graph_agent calls cannot target ${duplicate.target.name} more than once. Use sequential mode for repeated calls to the same node.`,
                    ),
                  )
                }

                const exclusiveServers = (yield* mcp.exclusiveServers()).map((name) => ({ name }))
                const conflict = findExclusiveMcpParallelConflict({ servers: exclusiveServers, calls: planned })
                if (conflict) {
                  const agents = conflict.targets.map((target) => target.name).join(" and ")
                  log.warn("parallel graph_agent rejected due to exclusive MCP conflict", {
                    serverName: conflict.serverName,
                    agents: conflict.targets.map((target) => ({ id: target.id, name: target.name })),
                  })
                  ctx.metadata({
                    title: "MCP scheduler",
                    metadata: {
                      mode,
                      status: "rejected",
                      reason: "exclusive_mcp_conflict",
                      mcpServer: conflict.serverName,
                      agentNodeIDs: conflict.targets.map((target) => target.id),
                    },
                  })
                  return yield* Effect.fail(
                    new Error(
                      `Parallel call rejected because ${agents} both have access to exclusive MCP server "${conflict.serverName}". Run these calls sequentially or change the MCP isolation mode.`,
                    ),
                  )
                }
              }

              const runCall = (call: PlannedGraphAgentCall) =>
                Effect.gen(function* () {
                  const target = call.target
                  const attribution = mode === "parallel" ? "best_effort_parallel" : "exact"
                  const safeTrack = () =>
                    snapshot.track().pipe(
                      Effect.catchCause((cause) =>
                        Effect.sync(() => {
                          log.warn("failed to capture graph_agent workspace snapshot", { cause: Cause.pretty(cause) })
                          return undefined
                        }),
                      ),
                    )
                  const changesFrom = (before: string | undefined, after: string | undefined) =>
                    Effect.gen(function* () {
                      if (!before || !after) {
                        return formatWorkspaceChanges({
                          unavailableReason: "snapshot tracking disabled or unavailable",
                          attribution,
                        })
                      }
                      const diffExit = yield* snapshot.diffFull(before, after).pipe(Effect.exit)
                      if (Exit.isFailure(diffExit)) {
                        log.warn("failed to diff graph_agent workspace snapshots", { cause: Cause.pretty(diffExit.cause) })
                        return formatWorkspaceChanges({
                          unavailableReason: "snapshot diff unavailable",
                          attribution,
                        })
                      }
                      return formatWorkspaceChanges({ diffs: diffExit.value, attribution })
                    })

                  yield* ctx.ask({
                    permission: "graph_agent",
                    patterns: [target.id],
                    always: [target.id],
                    metadata: {
                      orchestrator: current.node.name,
                      agent: target.name,
                      agent_node_id: target.id,
                      call_index: call.index,
                      mode,
                    },
                  })

                  let targetSessionID = target.sameChat ? target.currentChatSessionID : undefined
                  if (!targetSessionID) {
                    const created = yield* sessions.create({
                      parentID: current.node.graphSessionID,
                      title: `${target.name} call`,
                      agent: input.session.agent ?? input.agent.name,
                      model:
                        target.providerID && target.modelID
                          ? { providerID: target.providerID, id: target.modelID, variant: target.model?.variant }
                          : { providerID: input.model.providerID, id: input.model.id },
                      permission: target.permission,
                    })
                    targetSessionID = created.id
                    yield* graph.updateNode({
                      graphSessionID: current.node.graphSessionID,
                      nodeID: target.id,
                      patch: { currentChatSessionID: targetSessionID },
                    })
                  }

                  const targetSession = yield* sessions.get(targetSessionID).pipe(Effect.orDie)
                  const model =
                    target.providerID && target.modelID
                      ? { providerID: target.providerID, modelID: target.modelID }
                      : targetSession.model
                        ? { providerID: targetSession.model.providerID, modelID: targetSession.model.id }
                        : { providerID: input.model.providerID, modelID: input.model.id }
                  const variant =
                    target.model?.variant ??
                    targetSession.model?.variant ??
                    (!target.providerID || !target.modelID ? input.session.model?.variant : undefined)

                  const before = yield* safeTrack()
                  const resultExit = yield* input.promptOps
                    .prompt({
                      messageID: MessageID.ascending(),
                      sessionID: targetSessionID,
                      agent: targetSession.agent ?? input.session.agent ?? input.agent.name,
                      model,
                      variant,
                      parts: [{ type: "text", text: call.prompt }],
                    })
                    .pipe(Effect.exit)
                  const after = yield* safeTrack()
                  const workspaceChanges = yield* changesFrom(before, after)

                  if (Exit.isFailure(resultExit)) {
                    const error = Cause.squash(resultExit.cause)
                    return {
                      target,
                      sessionID: targetSessionID,
                      status: "error" as const,
                      output: error instanceof Error ? error.message : String(error),
                      workspaceChanges,
                    }
                  }

                  const result = resultExit.value

                  return {
                    target,
                    sessionID: targetSessionID,
                    status: "completed" as const,
                    output: result.parts.findLast((part) => part.type === "text")?.text ?? "",
                    workspaceChanges,
                  }
                }).pipe(
                  Effect.catchCause((cause) =>
                    Effect.sync(() => {
                      const error = Cause.squash(cause)
                      return {
                        target: call.target,
                        sessionID: undefined,
                        status: "error" as const,
                        output: error instanceof Error ? error.message : String(error),
                        workspaceChanges: formatWorkspaceChanges({
                          unavailableReason: "agent call failed before workspace snapshots were available",
                          attribution: mode === "parallel" ? "best_effort_parallel" : "exact",
                        }),
                      }
                    }),
                  ),
                )

              const results = yield* Effect.all(
                planned.map((call) => runCall(call)),
                {
                  concurrency: mode === "parallel" ? "unbounded" : 1,
                },
              )

              return {
                title:
                  results.length === 1
                    ? results[0].target.name
                    : `${mode === "parallel" ? "Parallel" : "Sequential"} graph calls`,
                metadata: {
                  graphSessionID: current.node.graphSessionID,
                  orchestratorNodeID: current.node.id,
                  mode,
                  mcpScheduling:
                    mode === "parallel"
                      ? {
                          exclusivePreflight: "passed",
                        }
                      : undefined,
                  calls: results.map((result, index) => ({
                    index,
                    status: result.status,
                    agentNodeID: result.target.id,
                    agentSessionID: result.sessionID,
                  })),
                },
                output: results.map(formatResult).join("\n\n"),
              }
            }),
          )
        },
      })
    }
  }

  const mcpTools =
    Option.isSome(graphContext)
      ? yield* mcp.toolsForContext({
          graphSessionID: graphContext.value.graph.state.graphSessionID,
          nodeID: graphContext.value.node.id,
          nodeType: graphContext.value.node.type,
        })
      : yield* mcp.tools()

  for (const [key, item] of Object.entries(mcpTools)) {
    const execute = item.execute
    if (!execute) continue

    const schema = yield* Effect.promise(() => Promise.resolve(asSchema(item.inputSchema).jsonSchema))
    const transformed = ProviderTransform.schema(input.model, schema)
    item.inputSchema = jsonSchema(transformed)
    item.execute = (args, opts) =>
      run.promise(
        Effect.gen(function* () {
          const ctx = context(args, opts)
          yield* plugin.trigger(
            "tool.execute.before",
            { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId },
            { args },
          )
          const result: Awaited<ReturnType<NonNullable<typeof execute>>> = yield* Effect.gen(function* () {
            yield* ctx.ask({ permission: key, metadata: {}, patterns: ["*"], always: ["*"] })
            return yield* Effect.promise(() => execute(args, opts))
          }).pipe(
            Effect.withSpan("Tool.execute", {
              attributes: {
                "tool.name": key,
                "tool.call_id": opts.toolCallId,
                "session.id": ctx.sessionID,
                "message.id": input.processor.message.id,
              },
            }),
          )
          yield* plugin.trigger(
            "tool.execute.after",
            { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId, args },
            result,
          )

          const textParts: string[] = []
          const attachments: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[] = []
          for (const contentItem of result.content) {
            if (contentItem.type === "text") textParts.push(contentItem.text)
            else if (contentItem.type === "image") {
              attachments.push({
                type: "file",
                mime: contentItem.mimeType,
                url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
              })
            } else if (contentItem.type === "resource") {
              const { resource } = contentItem
              if (resource.text) textParts.push(resource.text)
              if (resource.blob) {
                attachments.push({
                  type: "file",
                  mime: resource.mimeType ?? "application/octet-stream",
                  url: `data:${resource.mimeType ?? "application/octet-stream"};base64,${resource.blob}`,
                  filename: resource.uri,
                })
              }
            }
          }

          const truncated = yield* truncate.output(textParts.join("\n\n"), {}, input.agent)
          const metadata = {
            ...result.metadata,
            truncated: truncated.truncated,
            ...(truncated.truncated && { outputPath: truncated.outputPath }),
          }

          const output = {
            title: "",
            metadata,
            output: truncated.content,
            attachments: attachments.map((attachment) => ({
              ...attachment,
              id: PartID.ascending(),
              sessionID: ctx.sessionID,
              messageID: input.processor.message.id,
            })),
            content: result.content,
          }
          if (opts.abortSignal?.aborted) {
            yield* input.processor.completeToolCall(opts.toolCallId, output)
          }
          return output
        }),
      )
    tools[key] = item
  }

  enforceOrchestratorDelegation()
  return tools
})

export * as SessionTools from "./tools"
