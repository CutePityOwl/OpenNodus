import { Component, For } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { SettingsList } from "./settings-list"

const edgeTypes = [
  { id: "straight", label: "Straight" },
  { id: "step", label: "Step" },
  { id: "smoothstep", label: "Smooth step" },
  { id: "bezier", label: "Bezier" },
] as const

export const SettingsGraphNodes: Component = () => {
  const language = useLanguage()
  const settings = useSettings()

  return (
    <div class="flex flex-col gap-8 p-6">
      <div class="flex flex-col gap-1">
        <h2 class="text-20-medium text-text-strong">{language.t("settings.graphNodes.title")}</h2>
        <p class="text-13-regular text-text-weak">{language.t("settings.graphNodes.description")}</p>
      </div>

      <SettingsList>
        <div class="flex items-center justify-between gap-6 border-b border-border-base py-4 last:border-b-0">
          <div class="min-w-0">
            <div class="text-14-medium text-text-strong">{language.t("settings.graphNodes.edgeType.title")}</div>
            <div class="text-12-regular text-text-weak">
              {language.t("settings.graphNodes.edgeType.description")}
            </div>
          </div>
          <select
            class="h-8 min-w-36 rounded-md border border-border-base bg-background-strong px-2 text-sm text-text-base outline-none focus:border-border-strong"
            value={settings.graph.edgeType()}
            onChange={(event) => {
              const value = event.currentTarget.value
              if (value === "straight" || value === "step" || value === "smoothstep" || value === "bezier") {
                settings.graph.setEdgeType(value)
              }
            }}
          >
            <For each={edgeTypes}>{(type) => <option value={type.id}>{type.label}</option>}</For>
          </select>
        </div>
      </SettingsList>
    </div>
  )
}
