import type { GraphNode } from "@opencode-ai/sdk/v2/client"
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  NodeResizer,
  Position,
  SolidFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  type ResizeParams,
} from "@dschz/solid-flow"
import { Icon } from "@opencode-ai/ui/icon"
import { Show, createEffect } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useGraph } from "@/context/graph"

type OpenNodusNodeData = {
  graphNode: GraphNode
  selected: boolean
  onResizeEnd: (nodeID: string, size: { width: number; height: number }) => void
}

type OpenNodusFlowNode = Node<OpenNodusNodeData, "opennodus">
type OpenNodusFlowEdge = Edge<Record<string, unknown>, "smoothstep">

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
        "border-border-base": !selected(),
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
      <Handle type="target" position="left" />
      <Handle type="source" position="right" />

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
          <div class="text-[10px] font-medium uppercase tracking-normal text-text-weak">{node().type}</div>
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

export function SessionGraph() {
  const graph = useGraph()
  const [nodes, setNodes] = createStore<OpenNodusFlowNode[]>([])
  const [edges, setEdges] = createStore<OpenNodusFlowEdge[]>([])

  const persistNodeSize = (nodeID: string, size: { width: number; height: number }) => {
    void graph.updateNode(nodeID, { size })
  }

  createEffect(() => {
    const current = graph.current()
    if (!current) {
      setNodes(reconcile([]))
      setEdges(reconcile([]))
      return
    }

    const nextNodes = current.nodes.map((node) => toFlowNode(node, current.state.selectedNodeID, persistNodeSize))
    const nextEdges = current.edges.map(
      (edge) =>
        ({
          id: edge.id,
          source: edge.sourceNodeID,
          target: edge.targetNodeID,
          type: "smoothstep",
          animated: true,
        }) satisfies OpenNodusFlowEdge,
    )

    setNodes(reconcile(nextNodes))
    setEdges(reconcile(nextEdges))
  })

  const persistNodePosition = (node: OpenNodusFlowNode) => {
    void graph.updateNode(node.id, {
      position: {
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
      },
    })
  }

  return (
    <div class="relative h-full min-h-[220px] overflow-hidden border-b border-border-base bg-background-base">
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
        defaultEdgeOptions={{ type: "smoothstep" }}
        onNodeClick={({ node }) => void graph.selectNode(node.id)}
        onNodeDragStop={({ nodes }) => {
          const node = nodes[0]
          if (node) persistNodePosition(node)
        }}
        onSelectionChange={({ nodes }) => {
          const first = nodes[0]
          if (first) void graph.selectNode(first.id)
        }}
        class="opennodus-session-graph"
      >
        <Background variant="dots" gap={18} size={1} />
        <Controls position="bottom-left" />
        <MiniMap pannable zoomable width={128} height={88} />
      </SolidFlow>
    </div>
  )
}
