import type { Graph, GraphNode } from "@opencode-ai/sdk/v2/client"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createMemo } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useSDK } from "./sdk"

type NodePatch = {
  name?: string
  providerID?: string
  modelID?: string
  model?: GraphNode["model"]
  instructions?: string
  sameChat?: boolean
  canSpawnAgents?: boolean
  currentChatSessionID?: string
  position?: GraphNode["position"]
  size?: GraphNode["size"]
  permission?: GraphNode["permission"]
  toolPolicy?: GraphNode["toolPolicy"]
  mcpPolicy?: GraphNode["mcpPolicy"]
}

export const { use: useGraph, provider: GraphProvider } = createSimpleContext({
  name: "Graph",
  init: () => {
    const sdk = useSDK()
    const [store, setStore] = createStore({
      currentSessionID: undefined as string | undefined,
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
      const result = await sdk.client.graph.node.update({ sessionID, nodeID, ...patch })
      if (!result.data) return
      const graph = store.bySession[sessionID]
      if (!graph) return
      setGraph(sessionID, {
        ...graph,
        nodes: graph.nodes.map((node) => (node.id === result.data!.id ? result.data! : node)),
      })
      return result.data
    }

    return {
      get currentSessionID() {
        return store.currentSessionID
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
      open,
      ensure,
      selectNode,
      updateNode,
    }
  },
})
