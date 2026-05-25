import { describe, expect, test } from "bun:test"
import type { Node } from "../../src/graph/schema"
import { findExclusiveMcpParallelConflict, graphNodeMayUseMcpServer } from "../../src/session/graph-agent-mcp-scheduler"

const node = (name: string, permission: Node["permission"] = undefined): Node =>
  ({
    id: `gnode_${name}`,
    graphSessionID: "ses_test",
    type: "agent",
    name,
    sameChat: true,
    canSpawnAgents: false,
    position: { x: 0, y: 0 },
    permission,
    time: { created: 0, updated: 0 },
  }) as Node

describe("graph agent MCP scheduler", () => {
  test("assumes an agent may use an MCP server unless denied", () => {
    expect(graphNodeMayUseMcpServer(node("Agent A"), "playwright")).toBe(true)
    expect(
      graphNodeMayUseMcpServer(node("Agent A", [{ permission: "playwright", pattern: "*", action: "deny" }]), "playwright"),
    ).toBe(false)
    expect(
      graphNodeMayUseMcpServer(node("Agent A", [{ permission: "playwright_*", pattern: "*", action: "deny" }]), "playwright"),
    ).toBe(false)
  })

  test("finds exclusive MCP conflicts across parallel targets", () => {
    const agentA = node("Agent A")
    const agentB = node("Agent B")
    const conflict = findExclusiveMcpParallelConflict({
      servers: [{ name: "playwright" }],
      calls: [{ target: agentA }, { target: agentB }],
    })

    expect(conflict?.serverName).toBe("playwright")
    expect(conflict?.targets.map((target) => target.name)).toEqual(["Agent A", "Agent B"])
  })

  test("ignores agents that cannot use the exclusive MCP server", () => {
    const agentA = node("Agent A")
    const agentB = node("Agent B", [{ permission: "playwright", pattern: "*", action: "deny" }])
    const conflict = findExclusiveMcpParallelConflict({
      servers: [{ name: "playwright" }],
      calls: [{ target: agentA }, { target: agentB }],
    })

    expect(conflict).toBeUndefined()
  })
})
