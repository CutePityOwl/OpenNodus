import type { Node } from "@/graph/schema"
import { Permission } from "@/permission"

const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_")

export type PlannedGraphAgentTarget = {
  target: Node
}

export type ExclusiveMcpConflict = {
  serverName: string
  targets: Node[]
}

function unique(values: string[]) {
  return [...new Set(values)]
}

export function graphNodeMayUseMcpServer(node: Node, serverName: string) {
  const rules = node.permission ?? []
  if (rules.length === 0) return true

  const sanitized = sanitize(serverName)
  const probes = unique([
    serverName,
    sanitized,
    `${serverName}_tool`,
    `${sanitized}_tool`,
    `${serverName}:tool`,
    `${sanitized}:tool`,
  ])

  const actions = probes.map((permission) => Permission.evaluate(permission, "*", rules).action)
  if (actions.includes("allow")) return true
  if (actions.includes("deny")) return false
  return true
}

export function findExclusiveMcpParallelConflict(input: {
  servers: { name: string }[]
  calls: PlannedGraphAgentTarget[]
}): ExclusiveMcpConflict | undefined {
  for (const server of input.servers) {
    const targets = input.calls
      .map((call) => call.target)
      .filter((target) => graphNodeMayUseMcpServer(target, server.name))
    if (targets.length > 1) return { serverName: server.name, targets }
  }
}
