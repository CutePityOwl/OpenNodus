import type { Graph, GraphEdge, GraphNode } from "@opencode-ai/sdk/v2/client"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createMemo } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useSDK } from "./sdk"

type NodeType = GraphNode["type"]

type NodePatch = {
  name?: string
  providerID?: string | null
  modelID?: string | null
  model?: GraphNode["model"] | null
  instructions?: string | null
  sameChat?: boolean
  canSpawnAgents?: boolean
  currentChatSessionID?: string | null
  position?: GraphNode["position"]
  size?: GraphNode["size"] | null
  permission?: GraphNode["permission"] | null
  toolPolicy?: GraphNode["toolPolicy"] | null
  mcpPolicy?: GraphNode["mcpPolicy"] | null
}

type NodeCreate = {
  type: NodeType
  position: GraphNode["position"]
}

type EdgeCreate = {
  sourceNodeID: string
  targetNodeID: string
}

export const { use: useGraph, provider: GraphProvider } = createSimpleContext({
  name: "Graph",
  init: () => {
    const sdk = useSDK()
    const [store, setStore] = createStore({
      currentSessionID: undefined as string | undefined,
      settingsNodeID: undefined as string | undefined,
      linkingSourceNodeID: undefined as string | undefined,
      loading: false,
      error: undefined as unknown,
      bySession: {} as Record<string, Graph | undefined>,
    })

    const current = createMemo(() => {
      const sessionID = store.currentSessionID
      return sessionID ? store.bySession[sessionID] : undefined
    })

    const selectedNode = createMemo<GraphNode | undefined>(() => {
      const graph = current()
      if (!graph) return
      const selected = graph.state.selectedNodeID
      return (
        graph.nodes.find((node) => node.id === selected) ?? graph.nodes.find((node) => node.type === "orchestrator")
      )
    })

    const selectedNodeChatSessionID = createMemo(() => selectedNode()?.currentChatSessionID)

    const linkingSourceNode = createMemo<GraphNode | undefined>(() => {
      const graph = current()
      if (!graph) return
      const nodeID = store.linkingSourceNodeID
      if (!nodeID) return
      return graph.nodes.find((node) => node.id === nodeID)
    })

    const settingsNode = createMemo<GraphNode | undefined>(() => {
      const graph = current()
      if (!graph) return
      const nodeID = store.settingsNodeID
      if (!nodeID) return
      return graph.nodes.find((node) => node.id === nodeID)
    })

    const nodeByChatSessionID = (sessionID: string | undefined) => {
      const graph = current()
      if (!graph || !sessionID) return
      return graph.nodes.find((node) => node.currentChatSessionID === sessionID)
    }

    const setGraph = (sessionID: string, graph: Graph) => {
      setStore("bySession", sessionID, reconcile(graph))
    }

    const ensure = async (sessionID: string) => {
      setStore("currentSessionID", sessionID)
      setStore("loading", true)
      setStore("error", undefined)
      try {
        const result = await sdk.client.graph.ensure({ sessionID })
        if (result.data) setGraph(sessionID, result.data)
        return result.data
      } catch (error) {
        setStore("error", error)
        throw error
      } finally {
        setStore("loading", false)
      }
    }

    const open = (sessionID: string | undefined) => {
      setStore("currentSessionID", sessionID)
      if (!sessionID) return Promise.resolve(undefined)
      return ensure(sessionID)
    }

    const selectNode = async (nodeID: string | undefined) => {
      const sessionID = store.currentSessionID
      if (!sessionID) return
      const result = await sdk.client.graph.updateState({ sessionID, selectedNodeID: nodeID })
      if (!result.data) return
      const graph = store.bySession[sessionID]
      if (!graph) return
      setGraph(sessionID, { ...graph, state: result.data })
    }

    const updateNode = async (nodeID: string, patch: NodePatch) => {
      const sessionID = store.currentSessionID
      if (!sessionID) return
      const payload = { sessionID, nodeID, ...patch } as Parameters<typeof sdk.client.graph.node.update>[0]
      const result = await sdk.client.graph.node.update(payload)
      if (!result.data) return
      const graph = store.bySession[sessionID]
      if (!graph) return
      setGraph(sessionID, {
        ...graph,
        nodes: graph.nodes.map((node) => (node.id === result.data!.id ? result.data! : node)),
      })
      return result.data
    }

    const createNode = async (input: NodeCreate) => {
      const sessionID = store.currentSessionID
      if (!sessionID) return
      const graph = store.bySession[sessionID]
      const typeCount = graph?.nodes.filter((node) => node.type === input.type).length ?? 0
      const label = input.type === "orchestrator" ? "Orchestrator" : "Agent"
      const name = `${label} ${typeCount + 1}`

      const chat = await sdk.client.session.create({ parentID: sessionID, title: name })
      if (!chat.data) return

      const result = await sdk.client.graph.node.create({
        sessionID,
        type: input.type,
        name,
        currentChatSessionID: chat.data.id,
        position: input.position,
        sameChat: true,
        canSpawnAgents: false,
      })
      if (!result.data) return

      const current = store.bySession[sessionID]
      if (!current) return result.data

      setGraph(sessionID, {
        ...current,
        nodes: [...current.nodes, result.data],
      })

      return result.data
    }

    const createEdge = async (input: EdgeCreate) => {
      const sessionID = store.currentSessionID
      if (!sessionID) return
      const graph = store.bySession[sessionID]
      if (!graph) return

      if (input.sourceNodeID === input.targetNodeID) {
        throw new Error("Select a different target node")
      }

      const source = graph.nodes.find((node) => node.id === input.sourceNodeID)
      const target = graph.nodes.find((node) => node.id === input.targetNodeID)
      if (!source || !target) throw new Error("Graph node not found")
      if (source.type !== "orchestrator" || target.type !== "agent") {
        throw new Error("Only Orchestrator to Agent links are supported for now")
      }

      const existing = graph.edges.find(
        (edge) => edge.sourceNodeID === input.sourceNodeID && edge.targetNodeID === input.targetNodeID,
      )
      if (existing) return existing

      const result = await sdk.client.graph.edge.create({
        sessionID,
        sourceNodeID: input.sourceNodeID,
        targetNodeID: input.targetNodeID,
      })
      if (!result.data) return

      const current = store.bySession[sessionID]
      if (!current) return result.data
      setGraph(sessionID, {
        ...current,
        edges: [...current.edges, result.data as GraphEdge],
      })

      return result.data
    }

    const deleteEdge = async (edgeID: string) => {
      const sessionID = store.currentSessionID
      if (!sessionID) return
      const result = await sdk.client.graph.edge.delete({ sessionID, edgeID })
      if (!result.data) return
      const graph = store.bySession[sessionID]
      if (!graph) return
      setGraph(sessionID, {
        ...graph,
        edges: graph.edges.filter((edge) => edge.id !== edgeID),
      })
    }

    const openSettings = (nodeID?: string) => {
      const node = nodeID ?? selectedNode()?.id
      setStore("settingsNodeID", node)
    }

    const closeSettings = () => {
      setStore("settingsNodeID", undefined)
    }

    const startLink = (nodeID: string) => {
      setStore("linkingSourceNodeID", nodeID)
    }

    const clearLink = () => {
      setStore("linkingSourceNodeID", undefined)
    }

    return {
      get currentSessionID() {
        return store.currentSessionID
      },
      get settingsNodeID() {
        return store.settingsNodeID
      },
      get linkingSourceNodeID() {
        return store.linkingSourceNodeID
      },
      get loading() {
        return store.loading
      },
      get error() {
        return store.error
      },
      current,
      selectedNode,
      selectedNodeChatSessionID,
      linkingSourceNode,
      settingsNode,
      nodeByChatSessionID,
      open,
      ensure,
      selectNode,
      updateNode,
      createNode,
      createEdge,
      deleteEdge,
      openSettings,
      closeSettings,
      startLink,
      clearLink,
    }
  },
})
