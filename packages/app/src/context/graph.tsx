import type { Graph, GraphEdge, GraphNode, Session } from "@opencode-ai/sdk/v2/client"
import { Binary } from "@opencode-ai/core/util/binary"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createMemo } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { setSessionPrefetch } from "./global-sync/session-prefetch"
import { useGlobalSync } from "./global-sync"
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
  name?: string
  providerID?: string | null
  modelID?: string | null
  model?: GraphNode["model"] | null
  instructions?: string | null
  sameChat?: boolean
  canSpawnAgents?: boolean
  size?: GraphNode["size"] | null
  permission?: GraphNode["permission"]
  toolPolicy?: GraphNode["toolPolicy"] | null
  mcpPolicy?: GraphNode["mcpPolicy"] | null
}

type EdgeCreate = {
  sourceNodeID: string
  targetNodeID: string
}

export const { use: useGraph, provider: GraphProvider } = createSimpleContext({
  name: "Graph",
  init: () => {
    const sdk = useSDK()
    const globalSync = useGlobalSync()
    const [store, setStore] = createStore({
      currentSessionID: undefined as string | undefined,
      requestedSessionID: undefined as string | undefined,
      settingsNodeID: undefined as string | undefined,
      linkingSourceNodeID: undefined as string | undefined,
      loading: false,
      error: undefined as unknown,
      bySession: {} as Record<string, Graph | undefined>,
      activeChatNodeIDBySession: {} as Record<string, string | undefined>,
    })
    let openVersion = 0
    const pendingSelection = new Map<string, string | undefined>()

    const current = createMemo(() => {
      const sessionID = store.currentSessionID
      return sessionID ? store.bySession[sessionID] : undefined
    })

    const selectedNode = createMemo<GraphNode | undefined>(() => {
      if (store.currentSessionID !== store.requestedSessionID) return
      const graph = current()
      if (!graph) return
      const selected = graph.state.selectedNodeID
      return (
        graph.nodes.find((node) => node.id === selected) ?? graph.nodes.find((node) => node.type === "orchestrator")
      )
    })

    const selectedNodeChatSessionID = createMemo(() => selectedNode()?.currentChatSessionID)

    const fallbackChatNode = (graph: Graph) => graph.nodes.find((node) => node.type === "orchestrator") ?? graph.nodes[0]

    const activeChatNode = createMemo<GraphNode | undefined>(() => {
      if (store.currentSessionID !== store.requestedSessionID) return
      const sessionID = store.currentSessionID
      const graph = current()
      if (!graph || !sessionID) return
      const active = store.activeChatNodeIDBySession[sessionID]
      return graph.nodes.find((node) => node.id === active) ?? fallbackChatNode(graph)
    })

    const activeChatNodeChatSessionID = createMemo(() => activeChatNode()?.currentChatSessionID)

    const linkingSourceNode = createMemo<GraphNode | undefined>(() => {
      const graph = current()
      if (!graph) return
      const nodeID = store.linkingSourceNodeID
      if (!nodeID) return
      return graph.nodes.find((node) => node.id === nodeID)
    })

    const settingsNode = createMemo<GraphNode | undefined>(() => {
      if (store.currentSessionID !== store.requestedSessionID) return
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
      seedGraphNodeChats(graph)
      setStore("bySession", sessionID, reconcile(graph))
    }

    const seedGraphNodeChats = (graph: Graph) => {
      const [, setGlobalStore] = globalSync.child(sdk.directory)
      for (const node of graph.nodes) {
        const chatSessionID = node.currentChatSessionID
        if (!chatSessionID) continue
        setGlobalStore("message", chatSessionID, (messages) => messages ?? [])
      }
    }

    const seedNodeChat = (info: Session) => {
      const [, setGlobalStore] = globalSync.child(sdk.directory)
      setGlobalStore("session", (list: Session[]) => {
        const result = Binary.search(list, info.id, (item) => item.id)
        const next = [...list]
        if (result.found) {
          next[result.index] = info
          return next
        }
        next.splice(result.index, 0, info)
        return next
      })
      setGlobalStore("message", info.id, (messages) => messages ?? [])
      setSessionPrefetch({
        directory: sdk.directory,
        sessionID: info.id,
        limit: 0,
        complete: true,
      })
    }

    const load = async (sessionID: string, version: number, options?: { activate?: boolean }) => {
      const activate = options?.activate ?? true
      setStore("requestedSessionID", sessionID)
      setStore("loading", true)
      setStore("error", undefined)
      try {
        const result = await sdk.client.graph.ensure({ sessionID })
        if (result.data) setGraph(sessionID, result.data)
        if (activate && version === openVersion) {
          setStore("currentSessionID", sessionID)
          setStore("settingsNodeID", undefined)
          setStore("linkingSourceNodeID", undefined)
        }
        return result.data
      } catch (error) {
        if (version === openVersion) setStore("error", error)
        throw error
      } finally {
        if (version === openVersion) setStore("loading", false)
      }
    }

    const ensure = async (sessionID: string, options?: { activate?: boolean }) => {
      return load(sessionID, ++openVersion, options)
    }

    const open = (sessionID: string | undefined) => {
      const version = ++openVersion
      setStore("requestedSessionID", sessionID)
      setStore("settingsNodeID", undefined)
      setStore("linkingSourceNodeID", undefined)
      setStore("error", undefined)
      if (!sessionID) {
        setStore("currentSessionID", undefined)
        setStore("loading", false)
        return Promise.resolve(undefined)
      }
      if (store.bySession[sessionID]) {
        setStore("currentSessionID", sessionID)
        setStore("loading", false)
        return Promise.resolve(store.bySession[sessionID])
      }
      return load(sessionID, version)
    }

    const selectNode = async (nodeID: string | undefined) => {
      const sessionID = store.currentSessionID
      if (!sessionID) return
      const graph = store.bySession[sessionID]
      if (!graph) return
      if (store.settingsNodeID) setStore("settingsNodeID", nodeID)
      if (graph.state.selectedNodeID === nodeID) return
      if (pendingSelection.has(sessionID) && pendingSelection.get(sessionID) === nodeID) return
      pendingSelection.set(sessionID, nodeID)
      try {
        const result = await sdk.client.graph.updateState({ sessionID, selectedNodeID: nodeID })
        if (!result.data) return
        const current = store.bySession[sessionID]
        if (!current) return
        setGraph(sessionID, { ...current, state: result.data })
      } finally {
        if (pendingSelection.get(sessionID) === nodeID) pendingSelection.delete(sessionID)
      }
    }

    const selectChatNode = (nodeID: string | undefined) => {
      const sessionID = store.currentSessionID
      if (!sessionID) return
      const graph = store.bySession[sessionID]
      if (!graph) return
      if (nodeID && !graph.nodes.some((node) => node.id === nodeID)) return
      setStore("activeChatNodeIDBySession", sessionID, nodeID)
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
      const name = input.name ?? `${label} ${typeCount + 1}`

      const chat = await sdk.client.session.create({ parentID: sessionID, title: name, permission: input.permission })
      if (!chat.data) return
      seedNodeChat(chat.data)

      const result = await sdk.client.graph.node.create({
        sessionID,
        type: input.type,
        name,
        providerID: input.providerID ?? undefined,
        modelID: input.modelID ?? undefined,
        model: input.model ?? undefined,
        instructions: input.instructions ?? undefined,
        currentChatSessionID: chat.data.id,
        position: input.position,
        size: input.size ?? undefined,
        sameChat: input.sameChat ?? true,
        canSpawnAgents: input.canSpawnAgents ?? false,
        permission: input.permission,
        toolPolicy: input.toolPolicy ?? undefined,
        mcpPolicy: input.mcpPolicy ?? undefined,
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

    const detachNode = async (nodeID: string) => {
      const sessionID = store.currentSessionID
      if (!sessionID) return
      const graph = store.bySession[sessionID]
      if (!graph) return
      const related = graph.edges.filter((edge) => edge.sourceNodeID === nodeID || edge.targetNodeID === nodeID)
      for (const edge of related) {
        await deleteEdge(edge.id)
      }
    }

    const cloneNode = async (nodeID: string) => {
      const sessionID = store.currentSessionID
      if (!sessionID) return
      const graph = store.bySession[sessionID]
      const node = graph?.nodes.find((item) => item.id === nodeID)
      if (!node) return
      const positionX = Number(node.position.x)
      const positionY = Number(node.position.y)
      return createNode({
        type: node.type,
        name: `${node.name} - clone`,
        providerID: node.providerID ?? null,
        modelID: node.modelID ?? null,
        model: node.model ?? null,
        instructions: node.instructions ?? null,
        sameChat: node.sameChat,
        canSpawnAgents: node.canSpawnAgents,
        position: {
          x: Number.isFinite(positionX) ? positionX + 36 : 36,
          y: Number.isFinite(positionY) ? positionY + 36 : 36,
        },
        size: node.size ?? null,
        permission: node.permission,
        toolPolicy: node.toolPolicy ?? null,
        mcpPolicy: node.mcpPolicy ?? null,
      })
    }

    const createChatForNode = async (nodeID: string) => {
      const sessionID = store.currentSessionID
      if (!sessionID) return
      const graph = store.bySession[sessionID]
      const node = graph?.nodes.find((item) => item.id === nodeID)
      if (!node) return

      const chat = await sdk.client.session.create({ parentID: sessionID, title: node.name, permission: node.permission })
      if (!chat.data) return
      seedNodeChat(chat.data)

      await updateNode(nodeID, { currentChatSessionID: chat.data.id })
      return chat.data
    }

    const resetChatForNode = async (nodeID: string) => {
      const sessionID = store.currentSessionID
      if (!sessionID) return
      const graph = store.bySession[sessionID]
      const node = graph?.nodes.find((item) => item.id === nodeID)
      if (!node) return

      const previousChatSessionID = node.currentChatSessionID
      const chat = await sdk.client.session.create({ parentID: sessionID, title: node.name, permission: node.permission })
      if (!chat.data) return
      seedNodeChat(chat.data)
      await updateNode(nodeID, { currentChatSessionID: chat.data.id })

      if (previousChatSessionID && previousChatSessionID !== sessionID) {
        await sdk.client.session.delete({ sessionID: previousChatSessionID }).catch(() => undefined)
        const [, setGlobalStore] = globalSync.child(sdk.directory)
        setGlobalStore("session", (list: Session[]) => list.filter((item) => item.id !== previousChatSessionID))
      }

      return chat.data
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

    const deleteNode = async (nodeID: string) => {
      const sessionID = store.currentSessionID
      if (!sessionID) return
      const graph = store.bySession[sessionID]
      const node = graph?.nodes.find((item) => item.id === nodeID)
      if (!graph || !node) return

      const result = await sdk.client.graph.node.delete({ sessionID, nodeID })
      if (!result.data) return

      if (node.currentChatSessionID && node.currentChatSessionID !== sessionID) {
        await sdk.client.session.delete({ sessionID: node.currentChatSessionID }).catch(() => undefined)
        const [, setGlobalStore] = globalSync.child(sdk.directory)
        setGlobalStore("session", (list: Session[]) => list.filter((item) => item.id !== node.currentChatSessionID))
      }

      const nextNodes = graph.nodes.filter((item) => item.id !== nodeID)
      const nextEdges = graph.edges.filter((edge) => edge.sourceNodeID !== nodeID && edge.targetNodeID !== nodeID)
      setGraph(sessionID, {
        ...graph,
        nodes: nextNodes,
        edges: nextEdges,
        state: {
          ...graph.state,
          selectedNodeID: graph.state.selectedNodeID === nodeID ? undefined : graph.state.selectedNodeID,
        },
      })
      if (store.settingsNodeID === nodeID) setStore("settingsNodeID", undefined)
      if (store.linkingSourceNodeID === nodeID) setStore("linkingSourceNodeID", undefined)
      if (store.activeChatNodeIDBySession[sessionID] === nodeID) {
        setStore("activeChatNodeIDBySession", sessionID, undefined)
      }
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
      get requestedSessionID() {
        return store.requestedSessionID
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
      activeChatNode,
      activeChatNodeChatSessionID,
      linkingSourceNode,
      settingsNode,
      nodeByChatSessionID,
      open,
      ensure,
      selectNode,
      selectChatNode,
      updateNode,
      createNode,
      cloneNode,
      detachNode,
      createChatForNode,
      resetChatForNode,
      createEdge,
      deleteEdge,
      deleteNode,
      openSettings,
      closeSettings,
      startLink,
      clearLink,
    }
  },
})
