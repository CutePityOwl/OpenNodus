import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Switch } from "@opencode-ai/ui/switch"
import { showToast } from "@opencode-ai/ui/toast"
import { For, Show, createMemo, createSignal } from "solid-js"
import { useGraph } from "@/context/graph"
import { useLocal } from "@/context/local"
import { formatServerError } from "@/utils/server-errors"

export function NodeSettingsPanel() {
  const graph = useGraph()
  const dialog = useDialog()
  const local = useLocal()
  const node = graph.settingsNode
  const [customPermissionID, setCustomPermissionID] = createSignal("")

  const modelOptions = createMemo(() => local.model.list())
  const filteredModelOptions = createMemo(() => {
    const providerID = node()?.providerID
    if (!providerID) return modelOptions()
    return modelOptions().filter((model) => model.provider.id === providerID)
  })
  const providerOptions = createMemo(() => {
    const seen = new Map<string, string>()
    for (const model of modelOptions()) seen.set(model.provider.id, model.provider.name)
    return [...seen.entries()].map(([id, name]) => ({ id, name }))
  })
  const nodeModel = createMemo(() => {
    const item = node()
    if (!item?.providerID || !item.modelID) return
    return modelOptions().find((model) => model.provider.id === item.providerID && model.id === item.modelID)
  })
  const effectiveModel = createMemo(() => nodeModel() ?? local.model.current())
  const variantOptions = createMemo(() => {
    const variants = effectiveModel()?.variants
    return variants ? Object.keys(variants) : []
  })
  const permissionRows = [
    { id: "*", title: "All tools", description: "Fallback rule for every tool, including MCP tools." },
    { id: "read", title: "Read", description: "Read files." },
    { id: "edit", title: "Edit", description: "Modify files, including write and patch." },
    { id: "bash", title: "Bash", description: "Run shell commands." },
    { id: "glob", title: "Glob", description: "Match files by glob pattern." },
    { id: "grep", title: "Grep", description: "Search file contents." },
    { id: "list", title: "List", description: "List files in directories." },
    { id: "external_directory", title: "External directory", description: "Access files outside the workspace." },
    { id: "webfetch", title: "Web fetch", description: "Fetch content from URLs." },
    { id: "websearch", title: "Web search", description: "Search the web." },
    { id: "task", title: "Subagents", description: "Spawn OpenCode subagents." },
    { id: "todowrite", title: "Todo write", description: "Update todo lists." },
    { id: "lsp", title: "LSP", description: "Run language server queries." },
    { id: "skill", title: "Skill", description: "Load skills by name." },
    { id: "graph_agent", title: "Graph agent", description: "Call connected OpenNodus Agent nodes." },
  ] as const
  const commonPermissionIDs = new Set<string>(permissionRows.map((row) => row.id))
  const customPermissionRows = createMemo(() => {
    const item = node()
    return (item?.permission ?? []).filter((rule) => !commonPermissionIDs.has(rule.permission) || rule.pattern !== "*")
  })

  const update = async (patch: Parameters<typeof graph.updateNode>[1]) => {
    const item = node()
    if (!item) return
    try {
      await graph.updateNode(item.id, patch)
    } catch (error) {
      showToast({ title: "Failed to update node", description: formatServerError(error) })
    }
  }

  const updateProvider = (providerID: string) => {
    if (!providerID) {
      void update({ providerID: null, modelID: null, model: null })
      return
    }
    const first = modelOptions().find((model) => model.provider.id === providerID)
    void update({
      providerID,
      modelID: first?.id ?? null,
      model: first ? { providerID, id: first.id } : null,
    })
  }

  const updateModel = (value: string) => {
    const [providerID, modelID] = value.split("/", 2)
    if (!providerID || !modelID) {
      void update({ providerID: null, modelID: null, model: null })
      return
    }
    void update({ providerID, modelID, model: { providerID, id: modelID } })
  }

  const updateVariant = (variant: string) => {
    const item = node()
    if (!item) return
    const model = nodeModel() ?? local.model.current()
    if (!model) return
    void update({
      model: {
        providerID: model.provider.id,
        id: model.id,
        variant: variant || undefined,
      },
    })
  }

  const wildcardMatch = (value: string, pattern: string) => {
    if (pattern === "*") return true
    if (!pattern.includes("*")) return value === pattern
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
    return new RegExp(`^${escaped}$`).test(value)
  }

  const permissionAction = (permissionID: string, pattern = "*") => {
    const item = node()
    const rule = (item?.permission ?? []).findLast(
      (rule) => wildcardMatch(permissionID, rule.permission) && wildcardMatch(pattern, rule.pattern),
    )
    return rule?.action ?? "ask"
  }

  const setPermissionAction = (permissionID: string, action: "allow" | "ask" | "deny", pattern = "*") => {
    const item = node()
    if (!item) return
    const next = (item.permission ?? []).filter((rule) => rule.permission !== permissionID || rule.pattern !== pattern)
    next.push({ permission: permissionID, pattern, action })
    void update({ permission: next })
  }

  const removePermissionRule = (permissionID: string, pattern = "*") => {
    const item = node()
    if (!item) return
    const next = (item.permission ?? []).filter((rule) => rule.permission !== permissionID || rule.pattern !== pattern)
    void update({ permission: next.length > 0 ? next : null })
  }

  const addCustomPermissionRule = () => {
    const permissionID = customPermissionID().trim()
    if (!permissionID) return
    setPermissionAction(permissionID, "ask")
    setCustomPermissionID("")
  }

  const resetChat = async (nodeID: string) => {
    try {
      await graph.resetChatForNode(nodeID)
      showToast({ title: "Node chat reset" })
    } catch (error) {
      showToast({ title: "Failed to reset node chat", description: formatServerError(error) })
    }
  }

  const confirmResetChat = () => {
    const item = node()
    if (!item) return
    dialog.show(() => (
      <Dialog title="Reset node chat" fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1 text-sm text-text-base">
            <span>This will replace the current chat for {item.name} with a fresh chat.</span>
            <span class="text-text-weak">
              The previous node chat will be deleted along with its context and knowledge. This cannot be undone.
            </span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={() => {
                dialog.close()
                void resetChat(item.id)
              }}
            >
              Reset chat
            </Button>
          </div>
        </div>
      </Dialog>
    ))
  }

  return (
    <Show when={node()} keyed>
      {(item) => (
        <div class="h-full w-[320px] shrink-0 border-l border-border-base bg-background-base">
          <div class="flex h-full min-h-0 flex-col">
            <div class="flex h-11 shrink-0 items-center gap-2 border-b border-border-base px-3">
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium text-text-base">Node Settings</div>
                <div class="truncate text-xs text-text-weak">{item.type}</div>
              </div>
              <IconButton
                icon="close-small"
                variant="ghost"
                aria-label="Close node settings"
                onClick={graph.closeSettings}
              />
            </div>

            <div class="min-h-0 flex-1 overflow-auto p-3">
              <div class="flex flex-col gap-4">
                <label class="flex flex-col gap-1.5">
                  <span class="text-xs font-medium text-text-weak">Name</span>
                  <input
                    class="h-8 rounded-md border border-border-base bg-background-strong px-2 text-sm text-text-base outline-none focus:border-border-strong"
                    value={item.name}
                    onChange={(event) => {
                      const value = event.currentTarget.value.trim()
                      if (value) void update({ name: value })
                    }}
                  />
                </label>

                <label class="flex flex-col gap-1.5">
                  <span class="text-xs font-medium text-text-weak">Provider</span>
                  <select
                    class="h-8 rounded-md border border-border-base bg-background-strong px-2 text-sm text-text-base outline-none focus:border-border-strong"
                    value={item.providerID ?? ""}
                    onChange={(event) => updateProvider(event.currentTarget.value)}
                  >
                    <option value="">Session default</option>
                    <For each={providerOptions()}>
                      {(provider) => <option value={provider.id}>{provider.name}</option>}
                    </For>
                  </select>
                </label>

                <label class="flex flex-col gap-1.5">
                  <span class="text-xs font-medium text-text-weak">Model</span>
                  <select
                    class="h-8 rounded-md border border-border-base bg-background-strong px-2 text-sm text-text-base outline-none focus:border-border-strong"
                    value={item.providerID && item.modelID ? `${item.providerID}/${item.modelID}` : ""}
                    onChange={(event) => updateModel(event.currentTarget.value)}
                  >
                    <option value="">Session default</option>
                    <For each={filteredModelOptions()}>
                      {(model) => <option value={`${model.provider.id}/${model.id}`}>{model.name}</option>}
                    </For>
                  </select>
                  <Show when={effectiveModel()}>
                    {(model) => (
                      <span class="truncate text-xs text-text-weak">
                        {nodeModel() ? model().provider.name : `${model().provider.name} from session default`}
                      </span>
                    )}
                  </Show>
                </label>

                <Show when={variantOptions().length > 0}>
                  <label class="flex flex-col gap-1.5">
                    <span class="text-xs font-medium text-text-weak">Thinking</span>
                    <select
                      class="h-8 rounded-md border border-border-base bg-background-strong px-2 text-sm text-text-base outline-none focus:border-border-strong"
                      value={item.model?.variant ?? ""}
                      onChange={(event) => updateVariant(event.currentTarget.value)}
                    >
                      <option value="">Session default</option>
                      <For each={variantOptions()}>{(variant) => <option value={variant}>{variant}</option>}</For>
                    </select>
                    <span class="text-xs text-text-weak">Controls this node's model reasoning effort.</span>
                  </label>
                </Show>

                <label class="flex flex-col gap-1.5">
                  <span class="text-xs font-medium text-text-weak">Instructions</span>
                  <textarea
                    class="min-h-28 resize-y rounded-md border border-border-base bg-background-strong px-2 py-2 text-sm text-text-base outline-none focus:border-border-strong"
                    value={item.instructions ?? ""}
                    onChange={(event) => void update({ instructions: event.currentTarget.value || null })}
                  />
                </label>

                <div class="flex items-center justify-between gap-4 rounded-md border border-border-base p-3">
                  <div class="min-w-0">
                    <div class="text-sm text-text-base">Same chat</div>
                    <div class="text-xs text-text-weak">Reuse this node's existing chat when called.</div>
                  </div>
                  <Switch checked={item.sameChat} onChange={(checked) => void update({ sameChat: checked })} hideLabel>
                    Same chat
                  </Switch>
                </div>
                <Show when={item.sameChat && item.currentChatSessionID}>
                  <div class="rounded-md border border-border-base p-3">
                    <div class="flex items-center justify-between gap-3">
                      <div class="min-w-0">
                        <div class="text-sm text-text-base">Current chat: Chat</div>
                        <div class="truncate text-xs text-text-weak">{item.currentChatSessionID}</div>
                      </div>
                      <Button variant="secondary" onClick={confirmResetChat}>
                        Reset chat
                      </Button>
                    </div>
                  </div>
                </Show>

                <div class="flex items-center justify-between gap-4 rounded-md border border-border-base p-3">
                  <div class="min-w-0">
                    <div class="text-sm text-text-base">Can spawn agents</div>
                    <div class="text-xs text-text-weak">Allow this node to use OpenCode subagents.</div>
                  </div>
                  <Switch
                    checked={item.canSpawnAgents}
                    onChange={(checked) => void update({ canSpawnAgents: checked })}
                    hideLabel
                  >
                    Can spawn agents
                  </Switch>
                </div>

                <div class="rounded-md border border-border-base p-3">
                  <div class="text-sm text-text-base">Permissions</div>
                  <div class="mt-1 text-xs text-text-weak">
                    Controls this node's default tool permissions. Ask uses the normal permission prompt with Allow once,
                    Allow always, or Deny.
                  </div>
                  <div class="mt-3 flex flex-col gap-2">
                    <For each={permissionRows}>
                      {(row) => (
                        <div class="flex items-center justify-between gap-3 rounded-sm border border-border-base px-2 py-2">
                          <div class="min-w-0">
                            <div class="text-xs font-medium text-text-base">{row.title}</div>
                            <div class="text-[11px] text-text-weak">{row.description}</div>
                          </div>
                          <select
                            class="h-7 w-24 rounded-md border border-border-base bg-background-strong px-1.5 text-xs text-text-base outline-none focus:border-border-strong"
                            value={permissionAction(row.id)}
                            onChange={(event) =>
                              setPermissionAction(row.id, event.currentTarget.value as "allow" | "ask" | "deny")
                            }
                          >
                            <option value="ask">Ask</option>
                            <option value="allow">Allow</option>
                            <option value="deny">Deny</option>
                          </select>
                        </div>
                      )}
                    </For>
                  </div>
                </div>

                <div class="rounded-md border border-border-base p-3">
                  <div class="text-sm text-text-base">MCP and tools</div>
                  <div class="mt-1 text-xs text-text-weak">
                    MCP tools are controlled by the node that runs them. Add the MCP/tool permission ID here when you
                    need a node-specific rule for a tool such as Playwright.
                  </div>
                  <div class="mt-3 flex gap-2">
                    <input
                      class="h-8 min-w-0 flex-1 rounded-md border border-border-base bg-background-strong px-2 text-sm text-text-base outline-none focus:border-border-strong"
                      value={customPermissionID()}
                      placeholder="playwright or mcp tool id"
                      onInput={(event) => setCustomPermissionID(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return
                        event.preventDefault()
                        addCustomPermissionRule()
                      }}
                    />
                    <Button variant="secondary" onClick={addCustomPermissionRule}>
                      Add
                    </Button>
                  </div>
                  <Show when={customPermissionRows().length > 0}>
                    <div class="mt-3 flex flex-col gap-2">
                      <For each={customPermissionRows()}>
                        {(rule) => (
                          <div class="flex items-center justify-between gap-3 rounded-sm border border-border-base px-2 py-2">
                            <div class="min-w-0">
                              <div class="truncate text-xs font-medium text-text-base">{rule.permission}</div>
                              <div class="truncate text-[11px] text-text-weak">Pattern: {rule.pattern}</div>
                            </div>
                            <div class="flex shrink-0 items-center gap-1">
                              <select
                                class="h-7 w-24 rounded-md border border-border-base bg-background-strong px-1.5 text-xs text-text-base outline-none focus:border-border-strong"
                                value={rule.action}
                                onChange={(event) =>
                                  setPermissionAction(
                                    rule.permission,
                                    event.currentTarget.value as "allow" | "ask" | "deny",
                                    rule.pattern,
                                  )
                                }
                              >
                                <option value="ask">Ask</option>
                                <option value="allow">Allow</option>
                                <option value="deny">Deny</option>
                              </select>
                              <IconButton
                                icon="close-small"
                                variant="ghost"
                                class="size-7"
                                aria-label="Remove permission rule"
                                onClick={() => removePermissionRule(rule.permission, rule.pattern)}
                              />
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>

                <Button variant="secondary" onClick={graph.closeSettings}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Show>
  )
}
