import { Context, Effect, Layer } from "effect"

import { InstanceState } from "@/effect/instance-state"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_GPT from "./prompt/gpt.txt"
import PROMPT_KIMI from "./prompt/kimi.txt"
import PROMPT_OPENNODUS_AGENT from "./prompt/opennodus-agent.txt"
import PROMPT_OPENNODUS_ORCHESTRATOR from "./prompt/opennodus-orchestrator.txt"

import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"
import { Graph } from "@/graph/graph"
import type { Info as GraphInfo, Node as GraphNode } from "@/graph/schema"
import type { SessionID } from "./schema"

export function provider(model: Provider.Model) {
  if (model.api.id.includes("gpt-4") || model.api.id.includes("o1") || model.api.id.includes("o3"))
    return [PROMPT_BEAST]
  if (model.api.id.includes("gpt")) {
    if (model.api.id.includes("codex")) {
      return [PROMPT_CODEX]
    }
    return [PROMPT_GPT]
  }
  if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
  if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
  if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
  if (model.api.id.toLowerCase().includes("kimi")) return [PROMPT_KIMI]
  return [PROMPT_DEFAULT]
}

export interface Interface {
  readonly environment: (model: Provider.Model) => Effect.Effect<string[]>
  readonly skills: (agent: Agent.Info) => Effect.Effect<string | undefined>
  readonly opennodus: (input: {
    sessionID: SessionID
    model: Provider.Model
    agent: Agent.Info
  }) => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SystemPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const graph = yield* Graph.Service

    const modelSummary = (node: GraphNode, fallback: Provider.Model) => {
      if (node.providerID && node.modelID) {
        const variant = node.model?.variant ? ` (${node.model.variant})` : ""
        return `${node.providerID}/${node.modelID}${variant}`
      }
      return `session default (${fallback.providerID}/${fallback.api.id})`
    }

    const policySummary = (node: GraphNode) =>
      [
        `Permission policy: ${node.permission ? "custom node policy" : "session default"}`,
        `Tool policy: ${node.toolPolicy ? "custom node policy" : "default"}`,
        `MCP policy: ${node.mcpPolicy ? "custom node policy" : "default"}`,
      ].join("\n")

    const compact = (value: string | undefined) => {
      if (!value?.trim()) return "none"
      const text = value.trim().replace(/\s+/g, " ")
      return text.length > 260 ? `${text.slice(0, 257)}...` : text
    }

    const formatNode = (node: GraphNode, fallback: Provider.Model, detail: "full" | "summary" = "summary") =>
      [
        `- ${node.name} (${node.id})`,
        `  Role: ${node.type}`,
        `  Same chat: ${node.sameChat ? "enabled" : "disabled"}`,
        `  Model: ${modelSummary(node, fallback)}`,
        detail === "full" ? `  Can spawn agents: ${node.canSpawnAgents ? "enabled" : "disabled"}` : undefined,
        `  Instructions: ${compact(node.instructions)}`,
      ]
        .filter(Boolean)
        .join("\n")

    const connectedAgents = (info: GraphInfo, source: GraphNode) =>
      info.edges
        .filter((edge) => edge.sourceNodeID === source.id)
        .map((edge) => info.nodes.find((node) => node.id === edge.targetNodeID))
        .filter((node): node is GraphNode => !!node && node.type === "agent")

    const connectedOrchestrators = (info: GraphInfo, target: GraphNode) =>
      info.edges
        .filter((edge) => edge.targetNodeID === target.id)
        .map((edge) => info.nodes.find((node) => node.id === edge.sourceNodeID))
        .filter((node): node is GraphNode => !!node && node.type === "orchestrator")

    const siblingAgents = (info: GraphInfo, target: GraphNode) => {
      const orchestratorIDs = new Set(connectedOrchestrators(info, target).map((node) => node.id))
      const siblings = new Map<string, GraphNode>()
      for (const edge of info.edges) {
        if (!orchestratorIDs.has(edge.sourceNodeID)) continue
        if (edge.targetNodeID === target.id) continue
        const node = info.nodes.find((item) => item.id === edge.targetNodeID)
        if (node?.type === "agent") siblings.set(node.id, node)
      }
      return Array.from(siblings.values())
    }

    const nodeInstructions = (node: GraphNode) =>
      node.instructions?.trim()
        ? [`<opennodus_node_instructions>`, node.instructions.trim(), `</opennodus_node_instructions>`].join("\n")
        : undefined

    const orchestratorContext = (info: GraphInfo, node: GraphNode, model: Provider.Model) => {
      const agents = connectedAgents(info, node)
      return [
        `<opennodus_context>`,
        `Graph session: ${info.state.graphSessionID}`,
        ``,
        `Current node:`,
        formatNode(node, model, "full"),
        policySummary(node),
        ``,
        `Connected agents available through graph_agent:`,
        agents.length ? agents.map((agent) => formatNode(agent, model)).join("\n") : "none",
        ``,
        `Coordination guidance:`,
        `- Call only connected agents through graph_agent.`,
        `- Use sequential calls when one agent's result should inform another.`,
        `- Use parallel calls only when tasks are independent.`,
        `- Disconnected nodes are not callable.`,
        `</opennodus_context>`,
      ].join("\n")
    }

    const agentContext = (info: GraphInfo, node: GraphNode, model: Provider.Model) => {
      const orchestrators = connectedOrchestrators(info, node)
      const siblings = siblingAgents(info, node)
      return [
        `<opennodus_context>`,
        `Graph session: ${info.state.graphSessionID}`,
        ``,
        `Current node:`,
        formatNode(node, model, "full"),
        policySummary(node),
        ``,
        `Connected orchestrators:`,
        orchestrators.length ? orchestrators.map((item) => formatNode(item, model)).join("\n") : "none",
        ``,
        `Sibling agents connected to the same orchestrator:`,
        siblings.length ? siblings.map((item) => formatNode(item, model)).join("\n") : "none",
        ``,
        `Role guidance:`,
        `- Focus on your assigned task and node instructions.`,
        `- Use sibling-agent awareness to avoid doing work better assigned to another node.`,
        `- Return a clear final result for the orchestrator or user.`,
        `- You cannot directly call sibling graph nodes in the current runtime.`,
        `</opennodus_context>`,
      ].join("\n")
    }

    return Service.of({
      environment: Effect.fn("SystemPrompt.environment")(function* (model: Provider.Model) {
        const ctx = yield* InstanceState.context
        return [
          [
            `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
            `Here is some useful information about the environment you are running in:`,
            `<env>`,
            `  Working directory: ${ctx.directory}`,
            `  Workspace root folder: ${ctx.worktree}`,
            `  Is directory a git repo: ${ctx.project.vcs === "git" ? "yes" : "no"}`,
            `  Platform: ${process.platform}`,
            `  Today's date: ${new Date().toDateString()}`,
            `</env>`,
          ].join("\n"),
        ]
      }),

      skills: Effect.fn("SystemPrompt.skills")(function* (agent: Agent.Info) {
        if (Permission.disabled(["skill"], agent.permission).has("skill")) return

        const list = yield* skill.available(agent)

        return [
          "Skills provide specialized instructions and workflows for specific tasks.",
          "Use the skill tool to load a skill when a task matches its description.",
          // the agents seem to ingest the information about skills a bit better if we present a more verbose
          // version of them here and a less verbose version in tool description, rather than vice versa.
          Skill.fmt(list, { verbose: true }),
        ].join("\n")
      }),

      opennodus: Effect.fn("SystemPrompt.opennodus")(function* (input) {
        const match = yield* graph.findNodeByChatSessionID(input.sessionID).pipe(Effect.option)
        if (match._tag === "None") return []

        const node = match.value.node
        const role = node.type === "orchestrator" ? PROMPT_OPENNODUS_ORCHESTRATOR : PROMPT_OPENNODUS_AGENT
        const context =
          node.type === "orchestrator"
            ? orchestratorContext(match.value.graph, node, input.model)
            : agentContext(match.value.graph, node, input.model)

        return [role, context, nodeInstructions(node)].filter((item): item is string => !!item)
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Skill.defaultLayer), Layer.provide(Graph.defaultLayer))

export * as SystemPrompt from "./system"
