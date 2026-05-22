import type { GraphNode } from "@opencode-ai/sdk/v2/client"
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  NodeResizer,
  Position,
  SolidFlow,
  useSolidFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
  type Node,
  type NodeProps,
  type NodeTypes,
  type ResizeParams,
} from "@dschz/solid-flow"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { showToast } from "@opencode-ai/ui/toast"
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useGraph } from "@/context/graph"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"

type OpenNodusNodeData = {
  graphNode: GraphNode
  selected: boolean
  linkingSource: boolean
  permissionPending: boolean
  working: boolean
  onOpenSettings: (nodeID: string) => void
  onStartLink: (nodeID: string) => void
  onResizeEnd: (nodeID: string, size: { width: number; height: number }) => void
}

type OpenNodusFlowNode = Node<OpenNodusNodeData, "opennodus">
type OpenNodusFlowEdge = Edge<Record<string, unknown>, "smoothstep">
type GraphMenuState = {
  clientX: number
  clientY: number
  x: number
  y: number
}

function numeric(
  value: GraphNode["position"]["x"] | NonNullable<GraphNode["size"]>["width"] | undefined,
  fallback: number,
) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function nodeSize(node: GraphNode) {
  return {
    width: numeric(node.size?.width, node.type === "orchestrator" ? 240 : 220),
    height: numeric(node.size?.height, 132),
  }
}

function toFlowNode(
  node: GraphNode,
  selectedNodeID: string | undefined,
  linkingSourceNodeID: string | undefined,
  permissionPending: boolean,
  working: boolean,
  onOpenSettings: OpenNodusNodeData["onOpenSettings"],
  onStartLink: OpenNodusNodeData["onStartLink"],
  onResizeEnd: OpenNodusNodeData["onResizeEnd"],
) {
  const size = nodeSize(node)
  return {
    id: node.id,
    type: "opennodus",
    position: {
      x: numeric(node.position.x, 0),
      y: numeric(node.position.y, 0),
    },
    data: {
      graphNode: node,
      selected: selectedNodeID === node.id,
      linkingSource: linkingSourceNodeID === node.id,
      permissionPending,
      working,
      onOpenSettings,
      onStartLink,
      onResizeEnd,
    },
    selected: selectedNodeID === node.id,
    width: size.width,
    height: size.height,
    initialWidth: size.width,
    initialHeight: size.height,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    class: "opennodus-flow-node-shell",
  } satisfies OpenNodusFlowNode
}

function OpenNodusNode(props: NodeProps<OpenNodusNodeData, "opennodus">) {
  const node = () => props.data.graphNode
  const selected = () => props.data.selected
  const linkingSource = () => props.data.linkingSource
  const permissionPending = () => props.data.permissionPending
  const working = () => props.data.working

  const persistSize = (_event: unknown, params: ResizeParams) => {
    props.data.onResizeEnd(props.id, {
      width: Math.max(180, Math.round(params.width)),
      height: Math.max(96, Math.round(params.height)),
    })
  }

  return (
    <div
      class="relative size-full rounded-md border bg-background-base shadow-sm transition-colors"
      classList={{
        "border-border-strong shadow-md": selected(),
        "border-icon-info-active shadow-md": linkingSource(),
        "border-icon-warning-base shadow-md": permissionPending(),
        "border-success-base shadow-md": working() && !selected() && !linkingSource() && !permissionPending(),
        "border-border-base": !selected() && !linkingSource() && !permissionPending() && !working(),
      }}
    >
      <NodeResizer
        visible={selected()}
        minWidth={180}
        minHeight={96}
        handleClass="opennodus-node-resize-handle"
        lineClass="opennodus-node-resize-line"
        onResizeEnd={persistSize}
      />
      <div
        class="flex h-full min-h-0 flex-col overflow-hidden rounded-md"
        classList={{
          "bg-background-strong": node().type === "orchestrator",
          "bg-background-base": node().type === "agent",
        }}
      >
        <div class="flex h-9 shrink-0 items-center gap-2 border-b border-border-base px-3">
          <div
            class="flex size-5 shrink-0 items-center justify-center rounded-sm"
            classList={{
              "bg-surface-raised-base text-icon-info-active": node().type === "orchestrator",
              "bg-surface-raised-base text-icon-base": node().type === "agent",
            }}
          >
            <Icon name={node().type === "orchestrator" ? "brain" : "bubble-5"} size="small" />
          </div>
          <div class="min-w-0 flex-1 truncate text-sm font-medium text-text-base">{node().name}</div>
          <Show when={permissionPending()}>
            <Icon name="warning" size="small" class="shrink-0 text-icon-warning-base" />
          </Show>
          <Show when={working()}>
            <span class="size-2 shrink-0 rounded-full bg-icon-success-base animate-pulse" aria-label="Node running" />
          </Show>
          <div class="text-[10px] font-medium uppercase tracking-normal text-text-weak">{node().type}</div>
          <IconButton
            icon="link"
            variant="ghost"
            class="nodrag size-7 shrink-0"
            classList={{ "text-icon-info-active": linkingSource() }}
            disabled={node().type !== "orchestrator"}
            aria-label="Link from this node"
            onClick={(event) => {
              event.stopPropagation()
              if (node().type !== "orchestrator") return
              props.data.onStartLink(props.id)
            }}
          />
          <IconButton
            icon="settings-gear"
            variant="ghost"
            class="nodrag -mr-1 size-7 shrink-0"
            aria-label="Node settings"
            onClick={(event) => {
              event.stopPropagation()
              props.data.onOpenSettings(props.id)
            }}
          />
        </div>

        <div class="flex min-h-0 flex-1 flex-col gap-2 p-3 text-xs text-text-weak">
          <div class="truncate">
            <span class="text-text-base">Chat</span> {node().currentChatSessionID ?? "not assigned"}
          </div>
          <div class="truncate">
            <span class="text-text-base">Model</span>{" "}
            {node().providerID && node().modelID ? `${node().providerID}/${node().modelID}` : "session default"}
          </div>
          <div class="flex gap-1">
            <Show when={node().sameChat}>
              <span class="rounded-sm border border-border-base px-1.5 py-0.5">Same chat</span>
            </Show>
            <Show when={node().canSpawnAgents}>
              <span class="rounded-sm border border-border-base px-1.5 py-0.5">Can spawn</span>
            </Show>
          </div>
        </div>
      </div>

      <Show when={node().type === "agent"}>
        <Handle
          type="target"
          position="left"
          class="nodrag nopan opennodus-node-connection-handle opennodus-node-connection-handle-target"
        />
      </Show>
      <Show when={node().type === "orchestrator"}>
        <Handle
          type="source"
          position="right"
          class="nodrag nopan opennodus-node-connection-handle opennodus-node-connection-handle-source"
        />
      </Show>
    </div>
  )
}

const nodeTypes = {
  opennodus: OpenNodusNode,
} satisfies NodeTypes

function GraphContextMenu(props: {
  state: () => GraphMenuState | undefined
  onClose: () => void
  onCreate: (type: GraphNode["type"], position: GraphNode["position"]) => Promise<void>
}) {
  const flow = useSolidFlow<OpenNodusFlowNode, OpenNodusFlowEdge>()
  const items = [
    { type: "orchestrator" as const, label: "Add Orchestrator", icon: "brain" as const },
    { type: "agent" as const, label: "Add Agent", icon: "bubble-5" as const },
  ]

  const create = async (type: GraphNode["type"]) => {
    const state = props.state()
    if (!state) return
    props.onClose()
    const position = flow.screenToFlowPosition({ x: state.clientX, y: state.clientY }, { snapToGrid: true })
    await props.onCreate(type, {
      x: Math.round(position.x),
      y: Math.round(position.y),
    })
  }

  onMount(() => {
    const close = () => props.onClose()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose()
    }
    window.addEventListener("pointerdown", close)
    window.addEventListener("keydown", closeOnEscape)
    onCleanup(() => {
      window.removeEventListener("pointerdown", close)
      window.removeEventListener("keydown", closeOnEscape)
    })
  })

  return (
    <Show when={props.state()} keyed>
      {(state) => (
        <div
          class="absolute z-20 min-w-44 rounded-md border border-border-base bg-surface-raised-base p-1 shadow-lg"
          style={{ left: `${state.x}px`, top: `${state.y}px` }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <For each={items}>
            {(item) => (
              <button
                type="button"
                class="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-text-base hover:bg-surface-base-hover"
                onClick={() => void create(item.type)}
              >
                <Icon name={item.icon} size="small" class="text-icon-base" />
                <span>{item.label}</span>
              </button>
            )}
          </For>
        </div>
      )}
    </Show>
  )
}

export function SessionGraph() {
  const graph = useGraph()
  const permission = usePermission()
  const sdk = useSDK()
  const sync = useSync()
  const [nodes, setNodes] = createStore<OpenNodusFlowNode[]>([])
  const [edges, setEdges] = createStore<OpenNodusFlowEdge[]>([])
  const [menu, setMenu] = createSignal<GraphMenuState | undefined>()
  let root: HTMLDivElement | undefined

  const persistNodeSize = (nodeID: string, size: { width: number; height: number }) => {
    void graph.updateNode(nodeID, { size })
  }

  const startNodeLink = (nodeID: string) => {
    void graph.selectNode(nodeID)
    graph.startLink(nodeID)
  }

  const openNodeSettings = (nodeID: string) => {
    void graph.selectNode(nodeID)
    graph.openSettings(nodeID)
  }

  createEffect(() => {
    const current = graph.current()
    if (!current) {
      setNodes(reconcile([]))
      setEdges(reconcile([]))
      return
    }

    const nextNodes = current.nodes.map((node) => {
      const chatSessionID = node.currentChatSessionID
      return toFlowNode(
        node,
        current.state.selectedNodeID,
        graph.linkingSourceNodeID,
        !!chatSessionID &&
          (sync.data.permission[chatSessionID] ?? []).some((item) => !permission.autoResponds(item, sdk.directory)),
        !!chatSessionID && sync.data.session_working(chatSessionID),
        openNodeSettings,
        startNodeLink,
        persistNodeSize,
      )
    })
    const nextEdges = current.edges.map(
      (edge) =>
        ({
          id: edge.id,
          source: edge.sourceNodeID,
          target: edge.targetNodeID,
          type: "smoothstep",
          markerEnd: { type: MarkerType.ArrowClosed },
        }) satisfies OpenNodusFlowEdge,
    )

    setNodes(reconcile(nextNodes))
    setEdges(reconcile(nextEdges))
  })

  const persistNodePosition = (node: OpenNodusFlowNode) => {
    if (graph.loading) return
    void graph.updateNode(node.id, {
      position: {
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
      },
    })
  }

  const openMenu = (event: PointerEvent) => {
    if (graph.loading) return
    event.preventDefault()
    const rect = root?.getBoundingClientRect()
    setMenu({
      clientX: event.clientX,
      clientY: event.clientY,
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    })
  }

  const createNode = async (type: GraphNode["type"], position: GraphNode["position"]) => {
    if (graph.loading) return
    try {
      await graph.createNode({ type, position })
    } catch (error) {
      console.debug("[session-graph] failed to create node", error)
      showToast({ title: "Failed to create graph node" })
    }
  }

  const createEdge = async (sourceNodeID: string, targetNodeID: string) => {
    if (graph.loading) return
    try {
      await graph.createEdge({ sourceNodeID, targetNodeID })
    } catch (error) {
      console.debug("[session-graph] failed to create edge", error)
      showToast({ title: error instanceof Error ? error.message : "Failed to create graph link" })
    }
  }

  const connectNodes = async (connection: Pick<Connection, "source" | "target">) => {
    if (!connection.source || !connection.target) return
    await createEdge(connection.source, connection.target)
  }

  const isValidConnection: IsValidConnection = (connection) => {
    const current = graph.current()
    if (!current || !connection.source || !connection.target || connection.source === connection.target) return false
    const source = current.nodes.find((node) => node.id === connection.source)
    const target = current.nodes.find((node) => node.id === connection.target)
    if (source?.type !== "orchestrator" || target?.type !== "agent") return false
    return !current.edges.some(
      (edge) => edge.sourceNodeID === connection.source && edge.targetNodeID === connection.target,
    )
  }

  const selectNode = (nodeID: string) => {
    const current = graph.current()
    if (current?.state.selectedNodeID === nodeID) return
    void graph.selectNode(nodeID)
  }

  const handleNodeClick = async (nodeID: string) => {
    if (graph.loading) return
    const sourceNodeID = graph.linkingSourceNodeID
    if (!sourceNodeID) {
      selectNode(nodeID)
      return
    }

    graph.clearLink()
    selectNode(nodeID)
    await createEdge(sourceNodeID, nodeID)
  }

  const deleteEdges = (deleted: OpenNodusFlowEdge[]) => {
    if (graph.loading) return
    for (const edge of deleted) {
      void graph.deleteEdge(edge.id)
    }
  }

  return (
    <div
      ref={(el) => {
        root = el
      }}
      class="relative h-full min-h-[220px] overflow-hidden border-b border-border-base bg-background-base"
    >
      <SolidFlow<OpenNodusFlowNode, OpenNodusFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.25}
        maxZoom={1.6}
        snapGrid={[12, 12]}
        selectNodesOnDrag
        panOnScroll
        clickConnect
        defaultEdgeOptions={{ type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed } }}
        isValidConnection={isValidConnection}
        onConnect={(connection) => void connectNodes(connection)}
        onNodeClick={({ node }) => void handleNodeClick(node.id)}
        onEdgesDelete={deleteEdges}
        onPaneContextMenu={({ event }) => openMenu(event)}
        onPaneClick={() => {
          setMenu(undefined)
          graph.clearLink()
        }}
        onNodeDragStop={({ nodes }) => {
          if (graph.loading) return
          const node = nodes[0]
          if (node) persistNodePosition(node)
        }}
        onSelectionChange={({ nodes }) => {
          if (graph.loading) return
          const first = nodes[0]
          if (first && !graph.linkingSourceNodeID) selectNode(first.id)
        }}
        class="opennodus-session-graph"
        classList={{
          "pointer-events-none opacity-70": graph.loading,
        }}
      >
        <Background variant="dots" gap={18} size={1} />
        <Controls position="bottom-left" />
        <MiniMap pannable zoomable width={128} height={88} />
        <GraphContextMenu state={menu} onClose={() => setMenu(undefined)} onCreate={createNode} />
      </SolidFlow>
    </div>
  )
}
