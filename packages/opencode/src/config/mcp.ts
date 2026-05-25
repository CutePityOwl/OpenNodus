import { Schema } from "effect"
import { PositiveInt } from "@opencode-ai/core/schema"

export const IsolationMode = Schema.Literals([
  "shared",
  "shared_serial",
  "isolated_per_node",
  "isolated_per_call",
  "exclusive",
]).annotate({
  identifier: "McpIsolationMode",
  description: "How OpenNodus should route MCP access across graph nodes.",
})
export type IsolationMode = Schema.Schema.Type<typeof IsolationMode>

export const Port = Schema.Struct({
  strategy: Schema.Literals(["none", "auto"]).annotate({
    description: "How OpenNodus should allocate a port for isolated MCP runtimes.",
  }),
  env: Schema.optional(Schema.String).annotate({
    description: "Environment variable that receives the allocated port.",
  }),
  arg: Schema.optional(Schema.String).annotate({
    description: "Command argument template that receives the allocated port.",
  }),
}).annotate({ identifier: "McpIsolationPortConfig" })
export type Port = Schema.Schema.Type<typeof Port>

export const Isolation = Schema.Struct({
  mode: Schema.optional(IsolationMode).annotate({
    description: "Internal MCP runtime isolation mode. Defaults to shared_serial for graph-node MCP calls.",
  }),
  stateful: Schema.optional(Schema.Boolean).annotate({
    description: "Hint that the MCP server keeps mutable runtime state and should not be shared concurrently.",
  }),
  runtimeDir: Schema.optional(Schema.String).annotate({
    description: "Template or path for isolated MCP runtime data.",
  }),
  injectRuntimeEnv: Schema.optional(Schema.Boolean).annotate({
    description: "Inject OpenNodus runtime environment variables into isolated MCP server processes.",
  }),
  commandTemplate: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Optional command template used when launching isolated local MCP runtimes.",
  }),
  environmentTemplate: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "Optional environment template used when launching isolated local MCP runtimes.",
  }),
  port: Schema.optional(Port).annotate({
    description: "Optional dynamic port allocation configuration for isolated MCP runtimes.",
  }),
  idleTimeoutMs: Schema.optional(PositiveInt).annotate({
    description: "How long an idle isolated MCP runtime may remain alive before cleanup.",
  }),
}).annotate({ identifier: "McpIsolationConfig" })
export type Isolation = Schema.Schema.Type<typeof Isolation>

const Shared = {
  allowMultipleNodes: Schema.optional(Schema.Boolean).annotate({
    description:
      "Allow multiple OpenNodus graph nodes to use this MCP server in parallel. Maps to isolated runtimes when supported.",
  }),
  isolation: Schema.optional(Isolation).annotate({
    description: "Advanced MCP isolation and concurrency configuration.",
  }),
}

export const Local = Schema.Struct({
  type: Schema.Literal("local").annotate({ description: "Type of MCP server connection" }),
  command: Schema.mutable(Schema.Array(Schema.String)).annotate({
    description: "Command and arguments to run the MCP server",
  }),
  environment: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "Environment variables to set when running the MCP server",
  }),
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable or disable the MCP server on startup",
  }),
  timeout: Schema.optional(PositiveInt).annotate({
    description: "Timeout in ms for MCP server requests. Defaults to 5000 (5 seconds) if not specified.",
  }),
  ...Shared,
}).annotate({ identifier: "McpLocalConfig" })
export type Local = Schema.Schema.Type<typeof Local>

export const OAuth = Schema.Struct({
  clientId: Schema.optional(Schema.String).annotate({
    description: "OAuth client ID. If not provided, dynamic client registration (RFC 7591) will be attempted.",
  }),
  clientSecret: Schema.optional(Schema.String).annotate({
    description: "OAuth client secret (if required by the authorization server)",
  }),
  scope: Schema.optional(Schema.String).annotate({ description: "OAuth scopes to request during authorization" }),
  redirectUri: Schema.optional(Schema.String).annotate({
    description: "OAuth redirect URI (default: http://127.0.0.1:19876/mcp/oauth/callback).",
  }),
}).annotate({ identifier: "McpOAuthConfig" })
export type OAuth = Schema.Schema.Type<typeof OAuth>

export const Remote = Schema.Struct({
  type: Schema.Literal("remote").annotate({ description: "Type of MCP server connection" }),
  url: Schema.String.annotate({ description: "URL of the remote MCP server" }),
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable or disable the MCP server on startup",
  }),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "Headers to send with the request",
  }),
  oauth: Schema.optional(Schema.Union([OAuth, Schema.Literal(false)])).annotate({
    description: "OAuth authentication configuration for the MCP server. Set to false to disable OAuth auto-detection.",
  }),
  timeout: Schema.optional(PositiveInt).annotate({
    description: "Timeout in ms for MCP server requests. Defaults to 5000 (5 seconds) if not specified.",
  }),
  ...Shared,
}).annotate({ identifier: "McpRemoteConfig" })
export type Remote = Schema.Schema.Type<typeof Remote>

export const Info = Schema.Union([Local, Remote]).annotate({ discriminator: "type" })
export type Info = Schema.Schema.Type<typeof Info>

export function effectiveIsolationMode(mcp: Info): IsolationMode {
  if (mcp.isolation?.mode) return mcp.isolation.mode
  return mcp.allowMultipleNodes ? "isolated_per_node" : "shared_serial"
}

export * as ConfigMCP from "./mcp"
