import type { GraphNode } from "@opencode-ai/sdk/v2/client"
import {
  Background,
  BaseEdge,
  Controls,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  Handle,
  type ConnectionLineComponentProps,
  type EdgeProps,
  type EdgeTypes,
  type InternalNode,
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
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useGraph } from "@/context/graph"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"

type OpenNodusNodeData = {
  graphNode: GraphNode
  selected: boolean
  linkingSource: boolean
  permissionPending: boolean
  working: boolean
  onOpenSettings: (nodeID: string) => void
  onOpenContextMenu: (event: MouseEvent, nodeID: string) => void
  onResizeEnd: (nodeID: string, size: { width: number; height: number }) => void
}

type OpenNodusFlowNode = Node<OpenNodusNodeData, "opennodus">
type GraphEdgeType = "straight" | "step" | "smoothstep" | "bezier"
type OpenNodusFlowEdge = Edge<{ shape: GraphEdgeType }, "opennodus-floating">
type GraphMenuState = {
  clientX: number
  clientY: number
  x: number
  y: number
}
type NodeMenuState = GraphMenuState & {
  nodeID: string
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
  onOpenContextMenu: OpenNodusNodeData["onOpenContextMenu"],
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
      onOpenContextMenu,
      onResizeEnd,
    },
    selected: selectedNodeID === node.id,
    width: size.width,
    height: size.height,
    initialWidth: size.width,
    initialHeight: size.height,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    dragHandle: ".opennodus-node-drag-handle",
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
      onContextMenu={(event) => props.data.onOpenContextMenu(event, props.id)}
    >
      <Handle
        id="easy-connect"
        type="source"
        position={Position.Right}
        isConnectableStart
        isConnectableEnd
        class="opennodus-node-easy-connect-handle"
        style={{
          inset: "0",
          width: "100%",
          height: "100%",
          transform: "none",
        }}
      />
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
        <div class="opennodus-node-drag-handle flex h-9 shrink-0 cursor-grab items-center gap-2 border-b border-border-base px-3 active:cursor-grabbing">
          <div class="opennodus-node-drag-handle absolute inset-x-0 top-0 z-30 h-9 cursor-grab rounded-t-md active:cursor-grabbing" />
          <div
            class="relative z-40 flex size-5 shrink-0 items-center justify-center rounded-sm"
            classList={{
              "bg-surface-raised-base text-icon-info-active": node().type === "orchestrator",
              "bg-surface-raised-base text-icon-base": node().type === "agent",
            }}
          >
            <Icon name={node().type === "orchestrator" ? "brain" : "bubble-5"} size="small" />
          </div>
          <div class="relative z-40 min-w-0 flex-1 truncate text-sm font-medium text-text-base">{node().name}</div>
          <Show when={permissionPending()}>
            <Icon name="warning" size="small" class="relative z-40 shrink-0 text-icon-warning-base" />
          </Show>
          <Show when={working()}>
            <span
              class="relative z-40 size-2 shrink-0 rounded-full bg-icon-success-base animate-pulse"
              aria-label="Node running"
            />
          </Show>
          <div class="relative z-40 text-[10px] font-medium uppercase tracking-normal text-text-weak">{node().type}</div>
          <IconButton
            icon="settings-gear"
            variant="ghost"
            class="nodrag relative z-40 -mr-1 size-7 shrink-0"
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
    </div>
  )
}

const nodeTypes = {
  opennodus: OpenNodusNode,
} satisfies NodeTypes

type NodeRect = {
  x: number
  y: number
  width: number
  height: number
}

function internalNodeRect(node: InternalNode<OpenNodusFlowNode>): NodeRect {
  return {
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    width: node.measured?.width ?? node.width ?? node.initialWidth ?? 1,
    height: node.measured?.height ?? node.height ?? node.initialHeight ?? 1,
  }
}

function nodeCenter(rect: NodeRect) {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  }
}

function nodeIntersection(rect: NodeRect, target: { x: number; y: number }) {
  const center = nodeCenter(rect)
  const w = rect.width / 2
  const h = rect.height / 2
  const dx = target.x - center.x
  const dy = target.y - center.y
  const xx1 = dx / (2 * w) - dy / (2 * h)
  const yy1 = dx / (2 * w) + dy / (2 * h)
  const scale = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1)
  const xx3 = scale * xx1
  const yy3 = scale * yy1
  return {
    x: w * (xx3 + yy3) + center.x,
    y: h * (-xx3 + yy3) + center.y,
  }
}

function edgePosition(rect: NodeRect, point: { x: number; y: number }) {
  const px = Math.round(point.x)
  const py = Math.round(point.y)
  const left = Math.round(rect.x)
  const right = Math.round(rect.x + rect.width)
  const top = Math.round(rect.y)
  const bottom = Math.round(rect.y + rect.height)

  if (px <= left + 1) return Position.Left
  if (px >= right - 1) return Position.Right
  if (py <= top + 1) return Position.Top
  if (py >= bottom - 1) return Position.Bottom
  return Position.Right
}

function floatingEdgeParams(source: InternalNode<OpenNodusFlowNode>, target: InternalNode<OpenNodusFlowNode>) {
  const sourceRect = internalNodeRect(source)
  const targetRect = internalNodeRect(target)
  const sourcePoint = nodeIntersection(sourceRect, nodeCenter(targetRect))
  const targetPoint = nodeIntersection(targetRect, nodeCenter(sourceRect))

  return {
    sourceX: sourcePoint.x,
    sourceY: sourcePoint.y,
    targetX: targetPoint.x,
    targetY: targetPoint.y,
    sourcePosition: edgePosition(sourceRect, sourcePoint),
    targetPosition: edgePosition(targetRect, targetPoint),
  }
}

function floatingPath(
  params: ReturnType<typeof floatingEdgeParams>,
  shape: GraphEdgeType | undefined,
): ReturnType<typeof getBezierPath> {
  if (shape === "straight") return getStraightPath(params)
  if (shape === "step") return getSmoothStepPath({ ...params, borderRadius: 0 })
  if (shape === "smoothstep") return getSmoothStepPath(params)
  return getBezierPath(params)
}

function FloatingEdge(props: EdgeProps<{ shape: GraphEdgeType }, "opennodus-floating">) {
  const flow = useSolidFlow<OpenNodusFlowNode, OpenNodusFlowEdge>()
  const source = () => flow.getInternalNode(props.source)
  const target = () => flow.getInternalNode(props.target)
  const path = createMemo(() => {
    const sourceNode = source()
    const targetNode = target()
    if (!sourceNode || !targetNode) return
    return floatingPath(floatingEdgeParams(sourceNode, targetNode), props.data?.shape)
  })

  return (
    <Show when={path()} keyed>
      {([edgePath]) => (
        <BaseEdge
          id={props.id}
          path={edgePath}
          markerStart={props.markerStart}
          markerEnd={props.markerEnd}
          style={props.style}
          class={props.class}
        />
      )}
    </Show>
  )
}

function FloatingConnectionLine(props: ConnectionLineComponentProps<OpenNodusFlowNode>) {
  const path = createMemo(() => {
    const sourceRect = internalNodeRect(props.fromNode)
    const targetCenter = props.toNode ? nodeCenter(internalNodeRect(props.toNode)) : { x: props.toX, y: props.toY }
    const sourcePoint = nodeIntersection(sourceRect, targetCenter)
    const targetPoint = props.toNode
      ? nodeIntersection(internalNodeRect(props.toNode), nodeCenter(sourceRect))
      : { x: props.toX, y: props.toY }
    const params = {
      sourceX: sourcePoint.x,
      sourceY: sourcePoint.y,
      targetX: targetPoint.x,
      targetY: targetPoint.y,
      sourcePosition: edgePosition(sourceRect, sourcePoint),
      targetPosition: props.toNode ? edgePosition(internalNodeRect(props.toNode), targetPoint) : (props.toPosition as Position),
    }
    return floatingPath(params, "straight")[0]
  })

  return (
    <g>
      <path
        d={path()}
        fill="none"
        stroke="var(--border-active)"
        stroke-width="2"
        stroke-linecap="round"
        stroke-dasharray="6 4"
      />
    </g>
  )
}

const edgeTypes = {
  "opennodus-floating": FloatingEdge,
} satisfies EdgeTypes

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

function NodeContextMenu(props: {
  state: () => NodeMenuState | undefined
  onClose: () => void
  onDetach: (nodeID: string) => Promise<void>
  onClone: (nodeID: string) => Promise<void>
  onDelete: (nodeID: string) => Promise<void>
}) {
  const action = async (fn: (nodeID: string) => Promise<void>) => {
    const state = props.state()
    if (!state) return
    props.onClose()
    await fn(state.nodeID)
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
          class="absolute z-20 min-w-40 rounded-md border border-border-base bg-surface-raised-base p-1 shadow-lg"
          style={{ left: `${state.x}px`, top: `${state.y}px` }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            class="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-text-base hover:bg-surface-base-hover"
            onClick={() => void action(props.onDetach)}
          >
            <Icon name="link" size="small" class="text-icon-base" />
            <span>Detach</span>
          </button>
          <button
            type="button"
            class="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-text-base hover:bg-surface-base-hover"
            onClick={() => void action(props.onClone)}
          >
            <Icon name="copy" size="small" class="text-icon-base" />
            <span>Clone</span>
          </button>
          <div class="my-1 h-px bg-border-base" />
          <button
            type="button"
            class="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-text-danger-base hover:bg-surface-base-hover"
            onClick={() => void action(props.onDelete)}
          >
            <Icon name="trash" size="small" class="text-text-danger-base" />
            <span>Delete</span>
          </button>
        </div>
      )}
    </Show>
  )
}

export function SessionGraph() {
  const graph = useGraph()
  const permission = usePermission()
  const sdk = useSDK()
  const settings = useSettings()
  const sync = useSync()
  const [nodes, setNodes] = createStore<OpenNodusFlowNode[]>([])
  const [edges, setEdges] = createStore<OpenNodusFlowEdge[]>([])
  const [menu, setMenu] = createSignal<GraphMenuState | undefined>()
  const [nodeMenu, setNodeMenu] = createSignal<NodeMenuState | undefined>()
  let root: HTMLDivElement | undefined

  const persistNodeSize = (nodeID: string, size: { width: number; height: number }) => {
    void graph.updateNode(nodeID, { size })
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
        openNodeMenu,
        persistNodeSize,
      )
    })
    const nextEdges = current.edges.map(
      (edge) =>
        ({
          id: edge.id,
          source: edge.sourceNodeID,
          target: edge.targetNodeID,
          type: "opennodus-floating",
          data: { shape: settings.graph.edgeType() },
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
    setNodeMenu(undefined)
    const rect = root?.getBoundingClientRect()
    setMenu({
      clientX: event.clientX,
      clientY: event.clientY,
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    })
  }

  function openNodeMenu(event: MouseEvent, nodeID: string) {
    if (graph.loading) return
    event.preventDefault()
    event.stopPropagation()
    setMenu(undefined)
    void graph.selectNode(nodeID)
    const rect = root?.getBoundingClientRect()
    setNodeMenu({
      nodeID,
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

  const detachNode = async (nodeID: string) => {
    try {
      await graph.detachNode(nodeID)
    } catch (error) {
      console.debug("[session-graph] failed to detach node", error)
      showToast({ title: "Failed to detach graph node" })
    }
  }

  const cloneNode = async (nodeID: string) => {
    try {
      await graph.cloneNode(nodeID)
    } catch (error) {
      console.debug("[session-graph] failed to clone node", error)
      showToast({ title: "Failed to clone graph node" })
    }
  }

  const deleteNode = async (nodeID: string) => {
    try {
      await graph.deleteNode(nodeID)
    } catch (error) {
      console.debug("[session-graph] failed to delete node", error)
      showToast({ title: "Failed to delete graph node" })
    }
  }

  const edgePair = (firstNodeID: string, secondNodeID: string) => {
    const current = graph.current()
    if (!current || firstNodeID === secondNodeID) return
    const first = current.nodes.find((node) => node.id === firstNodeID)
    const second = current.nodes.find((node) => node.id === secondNodeID)
    if (!first || !second) return
    if (first.type === "orchestrator" && second.type === "agent") {
      return { sourceNodeID: first.id, targetNodeID: second.id }
    }
    if (first.type === "agent" && second.type === "orchestrator") {
      return { sourceNodeID: second.id, targetNodeID: first.id }
    }
  }

  const createEdge = async (sourceNodeID: string, targetNodeID: string) => {
    if (graph.loading) return
    const pair = edgePair(sourceNodeID, targetNodeID)
    if (!pair) {
      showToast({ title: "Only Orchestrator to Agent links are supported for now" })
      return
    }
    try {
      await graph.createEdge(pair)
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
    const pair = edgePair(connection.source, connection.target)
    if (!pair) return false
    return !current.edges.some(
      (edge) => edge.sourceNodeID === pair.sourceNodeID && edge.targetNodeID === pair.targetNodeID,
    )
  }

  const selectNode = (nodeID: string) => {
    const current = graph.current()
    if (current?.state.selectedNodeID === nodeID) return
    void graph.selectNode(nodeID)
  }

  const handleNodeClick = (nodeID: string) => {
    if (graph.loading) return
    selectNode(nodeID)
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
        edgeTypes={edgeTypes}
        fitView
        minZoom={0.25}
        maxZoom={1.6}
        snapGrid={[12, 12]}
        selectNodesOnDrag
        panOnScroll
        clickConnect={false}
        connectionMode="loose"
        defaultEdgeOptions={{ type: "opennodus-floating", markerEnd: { type: MarkerType.ArrowClosed } }}
        connectionLineComponent={FloatingConnectionLine}
        connectionLineStyle={{
          stroke: "var(--border-active)",
          "stroke-width": 2,
        }}
        isValidConnection={isValidConnection}
        onConnect={(connection) => void connectNodes(connection)}
        onNodeClick={({ node }) => void handleNodeClick(node.id)}
        onEdgesDelete={deleteEdges}
        onPaneContextMenu={({ event }) => openMenu(event)}
        onPaneClick={() => {
          setMenu(undefined)
          setNodeMenu(undefined)
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
          if (first) selectNode(first.id)
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
        <NodeContextMenu
          state={nodeMenu}
          onClose={() => setNodeMenu(undefined)}
          onDetach={detachNode}
          onClone={cloneNode}
          onDelete={deleteNode}
        />
      </SolidFlow>
    </div>
  )
}
