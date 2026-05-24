import type { Snapshot } from "@/snapshot"

const MAX_FILES = 30

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function fileLine(diff: Snapshot.FileDiff) {
  const path = escapeXml(diff.file ?? "unknown")
  return `    <file path="${path}" additions="${diff.additions}" deletions="${diff.deletions}" />`
}

function group(name: string, diffs: Snapshot.FileDiff[]) {
  if (diffs.length === 0) return undefined
  return [`  <${name}>`, ...diffs.map(fileLine), `  </${name}>`].join("\n")
}

function attrs(input: {
  attribution?: "exact" | "best_effort_parallel"
  truncated?: boolean
  totalFiles?: number
  reason?: string
}) {
  return [
    input.attribution === "best_effort_parallel" ? `attribution="best_effort_parallel"` : undefined,
    input.truncated ? `truncated="true"` : undefined,
    input.totalFiles !== undefined ? `total_files="${input.totalFiles}"` : undefined,
    input.reason ? `reason="${escapeXml(input.reason)}"` : undefined,
  ]
    .filter(Boolean)
    .join(" ")
}

export function formatWorkspaceChanges(input: {
  diffs?: Snapshot.FileDiff[]
  unavailableReason?: string
  attribution?: "exact" | "best_effort_parallel"
}) {
  if (input.unavailableReason) {
    const extra = attrs({ attribution: input.attribution, reason: input.unavailableReason })
    return `<workspace_changes status="unavailable"${extra ? ` ${extra}` : ""} />`
  }

  const diffs = input.diffs ?? []
  if (diffs.length === 0) {
    const extra = attrs({ attribution: input.attribution })
    return `<workspace_changes status="none"${extra ? ` ${extra}` : ""} />`
  }

  const listed = diffs.slice(0, MAX_FILES)
  const created = listed.filter((diff) => diff.status === "added")
  const deleted = listed.filter((diff) => diff.status === "deleted")
  const modified = listed.filter((diff) => diff.status === "modified" || !diff.status)
  const extra = attrs({
    attribution: input.attribution,
    truncated: diffs.length > MAX_FILES,
    totalFiles: diffs.length > MAX_FILES ? diffs.length : undefined,
  })
  const open = extra ? `<workspace_changes ${extra}>` : "<workspace_changes>"
  const sections = [group("created", created), group("modified", modified), group("deleted", deleted)].filter(
    (section): section is string => !!section,
  )

  return [open, ...sections, "</workspace_changes>"].join("\n")
}
