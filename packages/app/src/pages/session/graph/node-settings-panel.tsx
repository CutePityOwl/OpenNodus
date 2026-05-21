import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Switch } from "@opencode-ai/ui/switch"
import { showToast } from "@opencode-ai/ui/toast"
import { For, Show, createMemo } from "solid-js"
import { useGraph } from "@/context/graph"
import { useLocal } from "@/context/local"
import { formatServerError } from "@/utils/server-errors"

export function NodeSettingsPanel() {
  const graph = useGraph()
  const local = useLocal()
  const node = graph.settingsNode

  const modelOptions = createMemo(() => local.model.list())
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

  return (
    <Show when={node()} keyed>
      {(item) => (
        <aside class="hidden h-full w-[320px] shrink-0 border-l border-border-base bg-background-base md:block">
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
                    <For each={modelOptions()}>
                      {(model) => <option value={`${model.provider.id}/${model.id}`}>{model.name}</option>}
                    </For>
                  </select>
                  <Show when={nodeModel()}>
                    {(model) => <span class="truncate text-xs text-text-weak">{model().provider.name}</span>}
                  </Show>
                </label>

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
                  <div class="mt-1 text-xs text-text-weak">Node-level permission editing is planned for Phase 11.</div>
                </div>

                <div class="rounded-md border border-border-base p-3">
                  <div class="text-sm text-text-base">MCP and tools</div>
                  <div class="mt-1 text-xs text-text-weak">
                    Tool and MCP policies will be expanded after node permissions.
                  </div>
                </div>

                <Button variant="secondary" onClick={graph.closeSettings}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        </aside>
      )}
    </Show>
  )
}
