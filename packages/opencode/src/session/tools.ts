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
import type { TaskPromptOps } from "@/tool/task"
import { type Tool as AITool, tool, jsonSchema, type ToolExecutionOptions, asSchema } from "ai"
import { Cause, Effect, Option } from "effect"
import { MessageV2 } from "./message-v2"
import * as Session from "./session"
import { SessionProcessor } from "./processor"
import { MessageID, PartID } from "./schema"
import * as Log from "@opencode-ai/core/util/log"
import { EffectBridge } from "@/effect/bridge"

const log = Log.create({ service: "session.tools" })

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
    ask: (req) =>
      permission
        .ask({
          ...req,
          sessionID: input.session.id,
          tool: { messageID: input.processor.message.id, callID: options.toolCallId },
          ruleset: Permission.merge(input.agent.permission, input.session.permission ?? []),
        })
        .pipe(Effect.orDie),
  })

  for (const item of yield* registry.tools({
    modelID: ModelID.make(input.model.api.id),
    providerID: input.model.providerID,
    agent: input.agent,
  })) {
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

  const graphContext = yield* graph.findNodeByChatSessionID(input.session.id).pipe(Effect.option)
  if (Option.isSome(graphContext) && graphContext.value.node.type === "orchestrator") {
    const source = graphContext.value.node
    const connected = graphContext.value.graph.edges
      .filter((edge) => edge.sourceNodeID === source.id)
      .map((edge) => graphContext.value.graph.nodes.find((node) => node.id === edge.targetNodeID))
      .filter((node): node is Graph.Node => !!node && node.type === "agent")

    if (connected.length > 0) {
      const describeConnected = connected
        .map((node) => {
          const model = node.providerID && node.modelID ? `${node.providerID}/${node.modelID}` : "session default"
          return `- ${node.name} (${node.id}, ${model})`
        })
        .join("\n")

      tools.graph_agent = tool({
        description: [
          "Call a connected OpenNodus Agent node and return only that agent's final result.",
          "Use this for work that should be delegated through the graph rather than handled by this Orchestrator directly.",
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
              description: "The task prompt to send to the Agent node.",
            },
          },
          required: ["prompt"],
        }),
        execute(args, options) {
          return run.promise(
            Effect.gen(function* () {
              const params = args as Record<string, unknown>
              const ctx = context(args, options)
              const prompt = typeof params.prompt === "string" ? params.prompt.trim() : ""
              if (!prompt) return yield* Effect.fail(new Error("graph_agent requires a non-empty prompt"))

              const current = yield* graph.findNodeByChatSessionID(ctx.sessionID)
              if (current.node.type !== "orchestrator") {
                return yield* Effect.fail(new Error("graph_agent can only be used by Orchestrator nodes"))
              }

              const fresh = yield* graph.get(current.node.graphSessionID)
              const targets = fresh.edges
                .filter((edge) => edge.sourceNodeID === current.node.id)
                .map((edge) => fresh.nodes.find((node) => node.id === edge.targetNodeID))
                .filter((node): node is Graph.Node => !!node && node.type === "agent")

              const nodeID = typeof params.agent_node_id === "string" ? params.agent_node_id : undefined
              const nodeName = typeof params.agent_name === "string" ? params.agent_name : undefined
              const matches = targets.filter(
                (node) => (nodeID && node.id === nodeID) || (nodeName && node.name === nodeName),
              )
              const target =
                matches.length === 1
                  ? matches[0]
                  : !nodeID && !nodeName && targets.length === 1
                    ? targets[0]
                    : undefined

              if (!target) {
                const available = targets.map((node) => `${node.name} (${node.id})`).join(", ") || "none"
                return yield* Effect.fail(new Error(`Select exactly one connected Agent node. Available: ${available}`))
              }

              yield* ctx.ask({
                permission: "graph_agent",
                patterns: [target.id],
                always: [target.id],
                metadata: {
                  orchestrator: current.node.name,
                  agent: target.name,
                  agent_node_id: target.id,
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

              const result = yield* input.promptOps
                .prompt({
                  messageID: MessageID.ascending(),
                  sessionID: targetSessionID,
                  agent: targetSession.agent ?? input.session.agent ?? input.agent.name,
                  model,
                  variant: target.model?.variant ?? targetSession.model?.variant,
                  system: target.instructions,
                  parts: [{ type: "text", text: prompt }],
                })
                .pipe(
                  Effect.map((message) => message.parts.findLast((part) => part.type === "text")?.text ?? ""),
                  Effect.catchCause((cause) =>
                    Effect.sync(() => {
                      const error = Cause.squash(cause)
                      return [
                        `<agent_error node="${target.name}" node_id="${target.id}">`,
                        error instanceof Error ? error.message : String(error),
                        "</agent_error>",
                      ].join("\n")
                    }),
                  ),
                )

              return {
                title: target.name,
                metadata: {
                  graphSessionID: current.node.graphSessionID,
                  orchestratorNodeID: current.node.id,
                  agentNodeID: target.id,
                  agentSessionID: targetSessionID,
                },
                output: [`<agent_result node="${target.name}" node_id="${target.id}">`, result, "</agent_result>"].join(
                  "\n",
                ),
              }
            }),
          )
        },
      })
    }
  }

  for (const [key, item] of Object.entries(yield* mcp.tools())) {
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

  return tools
})

export * as SessionTools from "./tools"
