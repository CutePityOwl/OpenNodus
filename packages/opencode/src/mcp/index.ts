import { dynamicTool, type Tool, jsonSchema, type JSONSchema7 } from "ai"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import {
  CallToolResultSchema,
  ListToolsResultSchema,
  ToolSchema,
  type Tool as MCPToolDef,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { Config } from "@/config/config"
import { ConfigMCP } from "../config/mcp"
import * as Log from "@opencode-ai/core/util/log"
import { NamedError } from "@opencode-ai/core/util/error"
import { Installation } from "../installation"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { withTimeout } from "@/util/timeout"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { Hash } from "@opencode-ai/core/util/hash"
import { McpOAuthProvider } from "./oauth-provider"
import { McpOAuthCallback } from "./oauth-callback"
import { McpAuth } from "./auth"
import { BusEvent } from "../bus/bus-event"
import { Bus } from "@/bus"
import { ServerEvent } from "@/server/server-event"
import open from "open"
import { Effect, Exit, Layer, Option, Context, Schema, Stream } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { InstanceState } from "@/effect/instance-state"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import path from "path"

const log = Log.create({ service: "mcp" })
const DEFAULT_TIMEOUT = 30_000
const DEFAULT_QUEUE_TIMEOUT = 300_000

const TolerantListToolsResultSchema = ListToolsResultSchema.extend({
  tools: ToolSchema.omit({ outputSchema: true }).array(),
})

export const Resource = Schema.Struct({
  name: Schema.String,
  uri: Schema.String,
  description: Schema.optional(Schema.String),
  mimeType: Schema.optional(Schema.String),
  client: Schema.String,
}).annotate({ identifier: "McpResource" })
export type Resource = Schema.Schema.Type<typeof Resource>

export const ToolsChanged = BusEvent.define(
  "mcp.tools.changed",
  Schema.Struct({
    server: Schema.String,
  }),
)

export const BrowserOpenFailed = BusEvent.define(
  "mcp.browser.open.failed",
  Schema.Struct({
    mcpName: Schema.String,
    url: Schema.String,
  }),
)

export const Failed = NamedError.create("MCPFailed", {
  name: Schema.String,
})

type MCPClient = Client

const StatusConnected = Schema.Struct({ status: Schema.Literal("connected") }).annotate({
  identifier: "MCPStatusConnected",
})
const StatusDisabled = Schema.Struct({ status: Schema.Literal("disabled") }).annotate({
  identifier: "MCPStatusDisabled",
})
const StatusFailed = Schema.Struct({ status: Schema.Literal("failed"), error: Schema.String }).annotate({
  identifier: "MCPStatusFailed",
})
const StatusNeedsAuth = Schema.Struct({ status: Schema.Literal("needs_auth") }).annotate({
  identifier: "MCPStatusNeedsAuth",
})
const StatusNeedsClientRegistration = Schema.Struct({
  status: Schema.Literal("needs_client_registration"),
  error: Schema.String,
}).annotate({ identifier: "MCPStatusNeedsClientRegistration" })

export const Status = Schema.Union([
  StatusConnected,
  StatusDisabled,
  StatusFailed,
  StatusNeedsAuth,
  StatusNeedsClientRegistration,
]).annotate({ identifier: "MCPStatus", discriminator: "status" })
export type Status = Schema.Schema.Type<typeof Status>

// Store transports for OAuth servers to allow finishing auth
type TransportWithAuth = StreamableHTTPClientTransport | SSEClientTransport
const pendingOAuthTransports = new Map<string, TransportWithAuth>()

// Prompt cache types
type PromptInfo = Awaited<ReturnType<MCPClient["listPrompts"]>>["prompts"][number]
type ResourceInfo = Awaited<ReturnType<MCPClient["listResources"]>>["resources"][number]
type McpEntry = NonNullable<Config.Info["mcp"]>[string]

function isMcpConfigured(entry: McpEntry): entry is ConfigMCP.Info {
  return typeof entry === "object" && entry !== null && "type" in entry
}

const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_")

function remoteURL(key: string, value: string) {
  if (URL.canParse(value)) return new URL(value)
  log.warn("invalid remote mcp url", { key })
}

function isOutputSchemaValidationError(error: Error) {
  return /can't resolve reference|resolves to more than one schema|outputSchema|schema.*reference|reference.*schema/i.test(
    error.message,
  )
}

function listTools(key: string, client: MCPClient, timeout: number) {
  return Effect.tryPromise({
    try: () => client.listTools(undefined, { timeout }),
    catch: (err) => (err instanceof Error ? err : new Error(String(err))),
  }).pipe(
    Effect.map((result) => result.tools),
    Effect.catch((error) => {
      if (!isOutputSchemaValidationError(error)) return Effect.fail(error)

      log.warn("failed to validate MCP tool output schemas, retrying without output schema validation", { key, error })
      return Effect.tryPromise({
        try: () =>
          client.request({ method: "tools/list" }, TolerantListToolsResultSchema, {
            timeout,
          }),
        catch: (err) => (err instanceof Error ? err : new Error(String(err))),
      }).pipe(
        Effect.map((result) =>
          result.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        ),
      )
    }),
  )
}

type ExecuteMcpTool = (input: {
  args: unknown
  toolCallID?: string
  abort?: AbortSignal
  execute: () => Promise<unknown>
}) => Promise<unknown>

// Convert MCP tool definition to AI SDK Tool type
function convertMcpTool(mcpTool: MCPToolDef, client: MCPClient, timeout?: number, executeTool?: ExecuteMcpTool): Tool {
  const inputSchema = mcpTool.inputSchema

  // Spread first, then override type to ensure it's always "object"
  const schema: JSONSchema7 = {
    ...(inputSchema as JSONSchema7),
    type: "object",
    properties: (inputSchema.properties ?? {}) as JSONSchema7["properties"],
    additionalProperties: false,
  }

  return dynamicTool({
    description: mcpTool.description ?? "",
    inputSchema: jsonSchema(schema),
    execute: async (args: unknown, options) => {
      const execute = () =>
        client.callTool(
          {
            name: mcpTool.name,
            arguments: (args || {}) as Record<string, unknown>,
          },
          CallToolResultSchema,
          {
            resetTimeoutOnProgress: true,
            timeout,
          },
        )

      return executeTool
        ? executeTool({
            args,
            toolCallID: options.toolCallId,
            abort: options.abortSignal,
            execute,
          })
        : execute()
    },
  })
}

function makeAbortError(message: string) {
  return new Error(message)
}

function waitForQueueTurn(input: {
  serverName: string
  previous: Promise<void>
  abort?: AbortSignal
  timeout?: number
}) {
  return new Promise<void>((resolve, reject) => {
    if (input.abort?.aborted) {
      reject(makeAbortError(`MCP server "${input.serverName}" queue wait was aborted.`))
      return
    }

    let done = false
    const cleanup = () => {
      done = true
      if (input.abort) input.abort.removeEventListener("abort", onAbort)
      clearTimeout(timeoutID)
    }
    const onAbort = () => {
      if (done) return
      cleanup()
      reject(makeAbortError(`MCP server "${input.serverName}" queue wait was aborted.`))
    }
    const timeoutID = setTimeout(() => {
      if (done) return
      cleanup()
      reject(makeAbortError(`Timed out waiting for MCP server "${input.serverName}" to become available.`))
    }, input.timeout ?? DEFAULT_QUEUE_TIMEOUT)

    input.abort?.addEventListener("abort", onAbort, { once: true })
    input.previous.then(
      () => {
        if (done) return
        cleanup()
        resolve()
      },
      () => {
        if (done) return
        cleanup()
        resolve()
      },
    )
  })
}

function defs(key: string, client: MCPClient, timeout?: number) {
  return listTools(key, client, timeout ?? DEFAULT_TIMEOUT).pipe(
    Effect.catch((err) => {
      log.error("failed to get tools from client", { key, error: err })
      return Effect.succeed(undefined)
    }),
  )
}

function fetchFromClient<T extends { name: string }>(
  clientName: string,
  client: Client,
  listFn: (c: Client) => Promise<T[]>,
  label: string,
) {
  return Effect.tryPromise({
    try: () => listFn(client),
    catch: (e: any) => {
      log.error(`failed to get ${label}`, { clientName, error: e.message })
      return e
    },
  }).pipe(
    Effect.map((items) => {
      const out: Record<string, T & { client: string }> = {}
      const sanitizedClient = sanitize(clientName)
      for (const item of items) {
        out[sanitizedClient + ":" + sanitize(item.name)] = { ...item, client: clientName }
      }
      return out
    }),
    Effect.orElseSucceed(() => undefined),
  )
}

interface CreateResult {
  mcpClient?: MCPClient
  status: Status
  defs?: MCPToolDef[]
}

interface AuthResult {
  authorizationUrl: string
  oauthState: string
  client?: MCPClient
}

type RuntimeScope =
  | { type: "shared" }
  | { type: "node"; graphSessionID: string; nodeID: string }
  | { type: "call"; graphSessionID: string; nodeID: string; callID: string }

type RuntimeKey = string

export interface ToolsContext {
  graphSessionID?: string
  nodeID?: string
  nodeType?: "orchestrator" | "agent"
  callID?: string
}

interface RuntimeInstance {
  key: RuntimeKey
  serverName: string
  scope: RuntimeScope
  status: Status
  config?: ConfigMCP.Info
  client?: MCPClient
  defs?: MCPToolDef[]
  createdAt: number
  lastUsed: number
  runtimeDir?: string
}

type RuntimeToolEntry = {
  runtime: RuntimeInstance
  mcpConfig: ConfigMCP.Info | undefined
}

interface RuntimePaths {
  runtimeDir: string
  tmpDir: string
  cacheDir: string
  configDir: string
  dataDir: string
  artifactsDir: string
  profileDir: string
  logsDir: string
}

const runtimePaths = (runtimeDir: string): RuntimePaths => ({
  runtimeDir,
  tmpDir: path.join(runtimeDir, "tmp"),
  cacheDir: path.join(runtimeDir, "cache"),
  configDir: path.join(runtimeDir, "config"),
  dataDir: path.join(runtimeDir, "data"),
  artifactsDir: path.join(runtimeDir, "artifacts"),
  profileDir: path.join(runtimeDir, "profile"),
  logsDir: path.join(runtimeDir, "logs"),
})

const replacePlaceholders = (value: string, replacements: Record<string, string | undefined>) =>
  value.replace(/\{([^}]+)\}/g, (match, key) => replacements[key] ?? match)

export function sharedRuntimeKey(serverName: string): RuntimeKey {
  return serverName
}

export function nodeRuntimeKey(input: { serverName: string; graphSessionID: string; nodeID: string }): RuntimeKey {
  return [
    input.serverName,
    `graph_session=${encodeURIComponent(input.graphSessionID)}`,
    `node=${encodeURIComponent(input.nodeID)}`,
  ].join("::")
}

export function callRuntimeKey(input: {
  serverName: string
  graphSessionID: string
  nodeID: string
  callID: string
}): RuntimeKey {
  return [
    nodeRuntimeKey(input),
    `call=${encodeURIComponent(input.callID)}`,
  ].join("::")
}

export function runtimeDirectory(input: {
  root: string
  workspaceHash: string
  graphSessionID: string
  nodeID: string
  serverName: string
  callID?: string
}): string {
  const parts = [
    input.root,
    "mcp-runtimes",
    sanitize(input.workspaceHash),
    sanitize(input.graphSessionID),
    sanitize(input.nodeID),
    sanitize(input.serverName),
  ]
  if (input.callID) parts.push("calls", sanitize(input.callID))
  return path.join(...parts)
}

// --- Effect Service ---

interface State {
  runtimes: Record<RuntimeKey, RuntimeInstance>
}

export interface Interface {
  readonly status: () => Effect.Effect<Record<string, Status>>
  readonly clients: () => Effect.Effect<Record<string, MCPClient>>
  readonly tools: () => Effect.Effect<Record<string, Tool>>
  readonly toolsForContext: (context: ToolsContext) => Effect.Effect<Record<string, Tool>>
  readonly exclusiveServers: () => Effect.Effect<string[]>
  readonly prompts: () => Effect.Effect<Record<string, PromptInfo & { client: string }>>
  readonly resources: () => Effect.Effect<Record<string, ResourceInfo & { client: string }>>
  readonly add: (name: string, mcp: ConfigMCP.Info) => Effect.Effect<{ status: Record<string, Status> | Status }>
  readonly connect: (name: string) => Effect.Effect<void>
  readonly disconnect: (name: string) => Effect.Effect<void>
  readonly getPrompt: (
    clientName: string,
    name: string,
    args?: Record<string, string>,
  ) => Effect.Effect<Awaited<ReturnType<MCPClient["getPrompt"]>> | undefined>
  readonly readResource: (
    clientName: string,
    resourceUri: string,
  ) => Effect.Effect<Awaited<ReturnType<MCPClient["readResource"]>> | undefined>
  readonly startAuth: (mcpName: string) => Effect.Effect<{ authorizationUrl: string; oauthState: string }>
  readonly authenticate: (mcpName: string) => Effect.Effect<Status>
  readonly finishAuth: (mcpName: string, authorizationCode: string) => Effect.Effect<Status>
  readonly removeAuth: (mcpName: string) => Effect.Effect<void>
  readonly supportsOAuth: (mcpName: string) => Effect.Effect<boolean>
  readonly hasStoredTokens: (mcpName: string) => Effect.Effect<boolean>
  readonly getAuthStatus: (mcpName: string) => Effect.Effect<AuthStatus>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MCP") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const auth = yield* McpAuth.Service
    const bus = yield* Bus.Service
    const appFs = yield* AppFileSystem.Service
    const sharedSerialQueues = new Map<string, Promise<void>>()

    type Transport = StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport

    /**
     * Connect a client via the given transport with resource safety:
     * on failure the transport is closed; on success the caller owns it.
     */
    const connectTransport = (transport: Transport, timeout: number) =>
      Effect.acquireUseRelease(
        Effect.succeed(transport),
        (t) =>
          Effect.tryPromise({
            try: () => {
              const client = new Client({ name: "opencode", version: InstallationVersion })
              return withTimeout(client.connect(t), timeout).then(() => client)
            },
            catch: (e) => (e instanceof Error ? e : new Error(String(e))),
          }),
        (t, exit) => (Exit.isFailure(exit) ? Effect.tryPromise(() => t.close()).pipe(Effect.ignore) : Effect.void),
      )

    const DISABLED_RESULT: CreateResult = { status: { status: "disabled" } }

    const connectRemote = Effect.fn("MCP.connectRemote")(function* (
      key: string,
      mcp: ConfigMCP.Info & { type: "remote" },
    ) {
      const oauthDisabled = mcp.oauth === false
      const oauthConfig = typeof mcp.oauth === "object" ? mcp.oauth : undefined
      const url = remoteURL(key, mcp.url)
      if (!url) {
        return {
          client: undefined as MCPClient | undefined,
          status: { status: "failed" as const, error: `Invalid MCP URL for "${key}"` },
        }
      }
      let authProvider: McpOAuthProvider | undefined

      if (!oauthDisabled) {
        authProvider = new McpOAuthProvider(
          key,
          mcp.url,
          {
            clientId: oauthConfig?.clientId,
            clientSecret: oauthConfig?.clientSecret,
            scope: oauthConfig?.scope,
            redirectUri: oauthConfig?.redirectUri,
          },
          {
            onRedirect: async (url) => {
              log.info("oauth redirect requested", { key, url: url.toString() })
            },
          },
          auth,
        )
      }

      const transports: Array<{ name: string; transport: TransportWithAuth }> = [
        {
          name: "StreamableHTTP",
          transport: new StreamableHTTPClientTransport(url, {
            authProvider,
            requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
          }),
        },
        {
          name: "SSE",
          transport: new SSEClientTransport(url, {
            authProvider,
            requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
          }),
        },
      ]

      const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
      let lastStatus: Status | undefined

      for (const { name, transport } of transports) {
        const result = yield* connectTransport(transport, connectTimeout).pipe(
          Effect.map((client) => ({ client, transportName: name })),
          Effect.catch((error) => {
            const lastError = error instanceof Error ? error : new Error(String(error))
            const isAuthError =
              error instanceof UnauthorizedError || (authProvider && lastError.message.includes("OAuth"))

            if (isAuthError) {
              log.info("mcp server requires authentication", { key, transport: name })

              if (lastError.message.includes("registration") || lastError.message.includes("client_id")) {
                lastStatus = {
                  status: "needs_client_registration" as const,
                  error: "Server does not support dynamic client registration. Please provide clientId in config.",
                }
                return bus
                  .publish(ServerEvent.ToastShow, {
                    title: "MCP Authentication Required",
                    message: `Server "${key}" requires a pre-registered client ID. Add clientId to your config.`,
                    variant: "warning",
                    duration: 8000,
                  })
                  .pipe(Effect.ignore, Effect.as(undefined))
              } else {
                pendingOAuthTransports.set(key, transport)
                lastStatus = { status: "needs_auth" as const }
                return bus
                  .publish(ServerEvent.ToastShow, {
                    title: "MCP Authentication Required",
                    message: `Server "${key}" requires authentication. Run: opencode mcp auth ${key}`,
                    variant: "warning",
                    duration: 8000,
                  })
                  .pipe(Effect.ignore, Effect.as(undefined))
              }
            }

            log.debug("transport connection failed", {
              key,
              transport: name,
              url: mcp.url,
              error: lastError.message,
            })
            lastStatus = { status: "failed" as const, error: lastError.message }
            return Effect.succeed(undefined)
          }),
        )
        if (result) {
          log.info("connected", { key, transport: result.transportName })
          return { client: result.client as MCPClient | undefined, status: { status: "connected" } as Status }
        }
        // If this was an auth error, stop trying other transports
        if (lastStatus?.status === "needs_auth" || lastStatus?.status === "needs_client_registration") break
      }

      return {
        client: undefined as MCPClient | undefined,
        status: (lastStatus ?? { status: "failed", error: "Unknown error" }) as Status,
      }
    })

    const connectLocal = Effect.fn("MCP.connectLocal")(function* (
      key: string,
      mcp: ConfigMCP.Info & { type: "local" },
      options?: {
        command?: string[]
        environment?: Record<string, string>
        runtimeKey?: RuntimeKey
        runtimeDir?: string
      },
    ) {
      const command = options?.command ?? mcp.command
      const [cmd, ...args] = command
      const cwd = yield* InstanceState.directory
      const transport = new StdioClientTransport({
        stderr: "pipe",
        command: cmd,
        args,
        cwd,
        env: {
          ...process.env,
          ...(cmd === "opencode" ? { BUN_BE_BUN: "1" } : {}),
          ...mcp.environment,
          ...options?.environment,
        },
      })
      transport.stderr?.on("data", (chunk: Buffer) => {
        log.info(`mcp stderr: ${chunk.toString()}`, { key, runtimeKey: options?.runtimeKey })
      })

      const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
      return yield* connectTransport(transport, connectTimeout).pipe(
        Effect.map((client): { client: MCPClient | undefined; status: Status } => ({
          client,
          status: { status: "connected" },
        })),
        Effect.catch((error): Effect.Effect<{ client: MCPClient | undefined; status: Status }> => {
          const msg = error instanceof Error ? error.message : String(error)
          log.error("local mcp startup failed", {
            key,
            command,
            cwd,
            runtimeKey: options?.runtimeKey,
            runtimeDir: options?.runtimeDir,
            error: msg,
          })
          return Effect.succeed({ client: undefined, status: { status: "failed", error: msg } })
        }),
      )
    })

    const create = Effect.fn("MCP.create")(function* (key: string, mcp: ConfigMCP.Info) {
      if (mcp.enabled === false) {
        log.info("mcp server disabled", { key })
        return DISABLED_RESULT
      }

      log.info("found", { key, type: mcp.type })

      const { client: mcpClient, status } =
        mcp.type === "remote"
          ? yield* connectRemote(key, mcp as ConfigMCP.Info & { type: "remote" })
          : yield* connectLocal(key, mcp as ConfigMCP.Info & { type: "local" })

      if (!mcpClient) {
        return { status } satisfies CreateResult
      }

      const listed = yield* defs(key, mcpClient, mcp.timeout)
      if (!listed) {
        yield* Effect.tryPromise(() => mcpClient.close()).pipe(Effect.ignore)
        return { status: { status: "failed", error: "Failed to get tools" } } satisfies CreateResult
      }

      log.info("create() successfully created client", { key, toolCount: listed.length })
      return { mcpClient, status, defs: listed } satisfies CreateResult
    })
    const cfgSvc = yield* Config.Service

    const descendants = Effect.fnUntraced(
      function* (pid: number) {
        if (process.platform === "win32") return [] as number[]
        const pids: number[] = []
        const queue = [pid]
        while (queue.length > 0) {
          const current = queue.shift()!
          const handle = yield* spawner.spawn(ChildProcess.make("pgrep", ["-P", String(current)], { stdin: "ignore" }))
          const text = yield* Stream.mkString(Stream.decodeText(handle.stdout))
          yield* handle.exitCode
          for (const tok of text.split("\n")) {
            const cpid = parseInt(tok, 10)
            if (!isNaN(cpid) && !pids.includes(cpid)) {
              pids.push(cpid)
              queue.push(cpid)
            }
          }
        }
        return pids
      },
      Effect.scoped,
      Effect.catch(() => Effect.succeed([] as number[])),
    )

    function sharedRuntime(s: State, serverName: string) {
      return s.runtimes[sharedRuntimeKey(serverName)]
    }

    function placeholders(input: {
      paths: RuntimePaths
      context: ToolsContext
      serverName: string
      workspaceHash: string
      port?: string
    }) {
      return {
        runtimeDir: input.paths.runtimeDir,
        tmpDir: input.paths.tmpDir,
        cacheDir: input.paths.cacheDir,
        configDir: input.paths.configDir,
        dataDir: input.paths.dataDir,
        artifactsDir: input.paths.artifactsDir,
        profileDir: input.paths.profileDir,
        logsDir: input.paths.logsDir,
        graphSessionID: input.context.graphSessionID,
        nodeID: input.context.nodeID,
        callID: input.context.callID,
        serverName: input.serverName,
        workspaceHash: input.workspaceHash,
        port: input.port,
        opennodus_runtime_dir: input.paths.runtimeDir,
        opennodus_tmp_dir: input.paths.tmpDir,
        opennodus_cache_dir: input.paths.cacheDir,
        opennodus_config_dir: input.paths.configDir,
        opennodus_data_dir: input.paths.dataDir,
        opennodus_artifacts_dir: input.paths.artifactsDir,
        opennodus_profile_dir: input.paths.profileDir,
        opennodus_logs_dir: input.paths.logsDir,
        opennodus_graph_session_id: input.context.graphSessionID,
        opennodus_node_id: input.context.nodeID,
        opennodus_call_id: input.context.callID,
        opennodus_server_name: input.serverName,
        opennodus_workspace_hash: input.workspaceHash,
        opennodus_port: input.port,
      }
    }

    const ensureRuntimeDirs = Effect.fn("MCP.ensureRuntimeDirs")(function* (paths: RuntimePaths) {
      yield* Effect.forEach(
        [
          paths.runtimeDir,
          paths.tmpDir,
          paths.cacheDir,
          paths.configDir,
          paths.dataDir,
          paths.artifactsDir,
          paths.profileDir,
          paths.logsDir,
        ],
        (dir) => appFs.ensureDir(dir),
        { concurrency: "unbounded" },
      )
    })

    const createIsolatedLocalRuntime = Effect.fn("MCP.createIsolatedLocalRuntime")(function* (
      s: State,
      serverName: string,
      mcp: ConfigMCP.Info & { type: "local" },
      context: ToolsContext,
      bridge: EffectBridge.Shape,
    ) {
      if (!context.graphSessionID || !context.nodeID) return undefined

      const runtimeKey = nodeRuntimeKey({
        serverName,
        graphSessionID: context.graphSessionID,
        nodeID: context.nodeID,
      })
      const existing = s.runtimes[runtimeKey]
      if (existing?.status.status === "connected" && existing.client) {
        existing.lastUsed = Date.now()
        return existing
      }

      const workspace = yield* InstanceState.directory
      const workspaceHash = Hash.fast(workspace)
      const baseRuntimeDir = runtimeDirectory({
        root: Global.Path.data,
        workspaceHash,
        graphSessionID: context.graphSessionID,
        nodeID: context.nodeID,
        serverName,
      })
      const templateRuntimeDir = mcp.isolation?.runtimeDir
        ? replacePlaceholders(mcp.isolation.runtimeDir, {
            graphSessionID: context.graphSessionID,
            nodeID: context.nodeID,
            callID: context.callID,
            serverName,
            workspaceHash,
            opennodus_graph_session_id: context.graphSessionID,
            opennodus_node_id: context.nodeID,
            opennodus_call_id: context.callID,
            opennodus_server_name: serverName,
            opennodus_workspace_hash: workspaceHash,
          })
        : baseRuntimeDir
      const runtimeDir = path.isAbsolute(templateRuntimeDir)
        ? templateRuntimeDir
        : path.join(Global.Path.data, templateRuntimeDir)
      const paths = runtimePaths(runtimeDir)
      yield* ensureRuntimeDirs(paths).pipe(Effect.orDie)

      const replacements = placeholders({ paths, context, serverName, workspaceHash })
      const command = (mcp.isolation?.commandTemplate ?? mcp.command).map((item) =>
        replacePlaceholders(item, replacements),
      )
      const runtimeEnv: Record<string, string> = {
        OPENNODUS_MCP_RUNTIME_DIR: paths.runtimeDir,
        OPENNODUS_MCP_ARTIFACTS_DIR: paths.artifactsDir,
        OPENNODUS_MCP_PROFILE_DIR: paths.profileDir,
        OPENNODUS_MCP_CACHE_DIR: paths.cacheDir,
        OPENNODUS_MCP_TMP_DIR: paths.tmpDir,
        OPENNODUS_GRAPH_SESSION_ID: context.graphSessionID,
        OPENNODUS_GRAPH_NODE_ID: context.nodeID,
        OPENNODUS_MCP_SERVER_NAME: serverName,
        TMP: paths.tmpDir,
        TEMP: paths.tmpDir,
        TMPDIR: paths.tmpDir,
        XDG_CACHE_HOME: paths.cacheDir,
        XDG_CONFIG_HOME: paths.configDir,
        XDG_DATA_HOME: paths.dataDir,
      }
      if (context.callID) runtimeEnv.OPENNODUS_MCP_CALL_ID = context.callID

      const environmentTemplate = Object.fromEntries(
        Object.entries(mcp.isolation?.environmentTemplate ?? {}).map(([key, value]) => [
          key,
          replacePlaceholders(value, replacements),
        ]),
      )
      const result = yield* connectLocal(serverName, mcp, {
        command,
        environment: {
          ...runtimeEnv,
          ...environmentTemplate,
        },
        runtimeKey,
        runtimeDir: paths.runtimeDir,
      })

      const now = Date.now()
      const runtime: RuntimeInstance = {
        key: runtimeKey,
        serverName,
        scope: { type: "node", graphSessionID: context.graphSessionID, nodeID: context.nodeID },
        status: result.status,
        config: mcp,
        client: result.client,
        createdAt: existing?.createdAt ?? now,
        lastUsed: now,
        runtimeDir: paths.runtimeDir,
      }

      if (result.client) {
        const listed = yield* defs(serverName, result.client, mcp.timeout)
        if (!listed) {
          yield* Effect.tryPromise(() => result.client?.close() ?? Promise.resolve()).pipe(Effect.ignore)
          runtime.status = { status: "failed", error: "Failed to get tools" }
          delete runtime.client
        } else {
          runtime.defs = listed
          watch(s, runtimeKey, serverName, result.client, bridge, mcp.timeout)
        }
      }

      s.runtimes[runtimeKey] = runtime
      return runtime
    })

    const runtimeForContext = Effect.fn("MCP.runtimeForContext")(function* (
      s: State,
      serverName: string,
      mcp: ConfigMCP.Info | undefined,
      context: ToolsContext,
      bridge: EffectBridge.Shape,
    ) {
      const shared = sharedRuntime(s, serverName)
      if (!mcp || !context.graphSessionID || !context.nodeID) return shared

      const mode = ConfigMCP.effectiveIsolationMode(mcp)
      if ((mode === "isolated_per_node" || mode === "isolated_per_call") && mcp.type === "local") {
        const runtime = yield* createIsolatedLocalRuntime(s, serverName, mcp, context, bridge)
        if (runtime?.client) return runtime
      }

      if (mode === "isolated_per_node" || mode === "isolated_per_call") {
        const scoped = s.runtimes[
          nodeRuntimeKey({
            serverName,
            graphSessionID: context.graphSessionID,
            nodeID: context.nodeID,
          })
        ]
        return scoped?.client ? scoped : shared
      }

      return shared
    })

    function connectedSharedRuntimes(s: State) {
      return Object.values(s.runtimes).filter(
        (runtime) => runtime.scope.type === "shared" && runtime.status.status === "connected" && runtime.client,
      )
    }

    function clientsFromSharedRuntimes(s: State) {
      return Object.fromEntries(
        connectedSharedRuntimes(s).map((runtime) => [runtime.serverName, runtime.client!]),
      ) as Record<string, MCPClient>
    }

    function statusMapFromSharedRuntimes(s: State) {
      return Object.fromEntries(
        Object.values(s.runtimes)
          .filter((runtime) => runtime.scope.type === "shared")
          .map((runtime) => [runtime.serverName, runtime.status]),
      ) as Record<string, Status>
    }

    function setRuntimeStatus(s: State, serverName: string, status: Status, config?: ConfigMCP.Info) {
      const key = sharedRuntimeKey(serverName)
      const now = Date.now()
      const existing = s.runtimes[key]
      s.runtimes[key] = {
        key,
        serverName,
        scope: { type: "shared" },
        status,
        config: config ?? existing?.config,
        createdAt: existing?.createdAt ?? now,
        lastUsed: now,
      }
    }

    async function runSharedSerial(input: {
      serverName: string
      runtimeKey: RuntimeKey
      toolName: string
      context: ToolsContext
      abort?: AbortSignal
      timeout?: number
      execute: () => Promise<unknown>
    }) {
      const queued = sharedSerialQueues.has(input.serverName)
      const previous = sharedSerialQueues.get(input.serverName) ?? Promise.resolve()
      let release: (() => void) | undefined
      const current = previous
        .catch(() => {})
        .then(
          () =>
            new Promise<void>((resolve) => {
              release = resolve
            }),
        )
      sharedSerialQueues.set(
        input.serverName,
        current.finally(() => {
          if (sharedSerialQueues.get(input.serverName) === current) sharedSerialQueues.delete(input.serverName)
        }),
      )

      if (queued) {
        log.debug("mcp shared-serial queued", {
          serverName: input.serverName,
          runtimeKey: input.runtimeKey,
          toolName: input.toolName,
          graphSessionID: input.context.graphSessionID,
          nodeID: input.context.nodeID,
        })
      }

      try {
        await waitForQueueTurn({
          serverName: input.serverName,
          previous,
          abort: input.abort,
          timeout: input.timeout ?? DEFAULT_QUEUE_TIMEOUT,
        })
        if (input.abort?.aborted) throw makeAbortError(`MCP server "${input.serverName}" tool call was aborted.`)
        return await input.execute()
      } finally {
        release?.()
      }
    }

    function watch(
      s: State,
      runtimeKey: RuntimeKey,
      serverName: string,
      client: MCPClient,
      bridge: EffectBridge.Shape,
      timeout?: number,
    ) {
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        log.info("tools list changed notification received", { server: serverName, runtimeKey })
        const runtime = s.runtimes[runtimeKey]
        if (runtime?.client !== client || runtime.status.status !== "connected") return

        const listed = await bridge.promise(defs(serverName, client, timeout))
        if (!listed) return
        if (s.runtimes[runtimeKey]?.client !== client || s.runtimes[runtimeKey]?.status.status !== "connected") return

        s.runtimes[runtimeKey].defs = listed
        s.runtimes[runtimeKey].lastUsed = Date.now()
        await bridge.promise(bus.publish(ToolsChanged, { server: serverName }).pipe(Effect.ignore))
      })
    }

    const state = yield* InstanceState.make<State>(
      Effect.fn("MCP.state")(function* () {
        const cfg = yield* cfgSvc.get()
        const bridge = yield* EffectBridge.make()
        const config = cfg.mcp ?? {}
        const s: State = {
          runtimes: {},
        }

        yield* Effect.forEach(
          Object.entries(config),
          ([key, mcp]) =>
            Effect.gen(function* () {
              if (!isMcpConfigured(mcp)) {
                log.error("Ignoring MCP config entry without type", { key })
                return
              }

              if (mcp.enabled === false) {
                setRuntimeStatus(s, key, { status: "disabled" }, mcp)
                return
              }

              const result = yield* create(key, mcp).pipe(Effect.catch(() => Effect.void))
              if (!result) return

              setRuntimeStatus(s, key, result.status, mcp)
              if (result.mcpClient) {
                const runtimeKey = sharedRuntimeKey(key)
                const runtime = s.runtimes[runtimeKey]
                runtime.config = mcp
                runtime.client = result.mcpClient
                runtime.defs = result.defs!
                runtime.lastUsed = Date.now()
                watch(s, runtimeKey, key, result.mcpClient, bridge, mcp.timeout)
              }
            }),
          { concurrency: "unbounded" },
        )

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            yield* Effect.forEach(
              Object.values(s.runtimes),
              (runtime) =>
                Effect.gen(function* () {
                  const client = runtime.client
                  if (!client) return
                  const pid = client.transport instanceof StdioClientTransport ? client.transport.pid : null
                  if (typeof pid === "number") {
                    const pids = yield* descendants(pid)
                    for (const dpid of pids) {
                      try {
                        process.kill(dpid, "SIGTERM")
                      } catch {}
                    }
                  }
                  yield* Effect.tryPromise(() => client.close()).pipe(Effect.ignore)
                }),
              { concurrency: "unbounded" },
            )
            pendingOAuthTransports.clear()
          }),
        )

        return s
      }),
    )

    function closeClient(s: State, name: string) {
      const runtime = sharedRuntime(s, name)
      const client = runtime?.client
      if (runtime) {
        delete runtime.client
        delete runtime.defs
        runtime.lastUsed = Date.now()
      }
      if (!client) return Effect.void
      return Effect.tryPromise(() => client.close()).pipe(Effect.ignore)
    }

    const storeClient = Effect.fnUntraced(function* (
      s: State,
      name: string,
      client: MCPClient,
      listed: MCPToolDef[],
      timeout?: number,
      config?: ConfigMCP.Info,
    ) {
      const bridge = yield* EffectBridge.make()
      yield* closeClient(s, name)
      const runtimeKey = sharedRuntimeKey(name)
      const now = Date.now()
      s.runtimes[runtimeKey] = {
        key: runtimeKey,
        serverName: name,
        scope: { type: "shared" },
        status: { status: "connected" },
        config: config ?? s.runtimes[runtimeKey]?.config,
        client,
        defs: listed,
        createdAt: s.runtimes[runtimeKey]?.createdAt ?? now,
        lastUsed: now,
      }
      watch(s, runtimeKey, name, client, bridge, timeout)
      return s.runtimes[runtimeKey].status
    })

    const status = Effect.fn("MCP.status")(function* () {
      const s = yield* InstanceState.get(state)

      const cfg = yield* cfgSvc.get()
      const config = cfg.mcp ?? {}
      const result: Record<string, Status> = {}

      for (const [key, mcp] of Object.entries(config)) {
        if (!isMcpConfigured(mcp)) continue
        result[key] = sharedRuntime(s, key)?.status ?? { status: "disabled" }
      }

      return result
    })

    const clients = Effect.fn("MCP.clients")(function* () {
      const s = yield* InstanceState.get(state)
      return clientsFromSharedRuntimes(s)
    })

    const exclusiveServers = Effect.fn("MCP.exclusiveServers")(function* () {
      const cfg = yield* cfgSvc.get()
      const servers: string[] = []
      for (const [name, mcpConfig] of Object.entries(cfg.mcp ?? {})) {
        if (!isMcpConfigured(mcpConfig)) continue
        if (mcpConfig.enabled === false) continue
        if (ConfigMCP.effectiveIsolationMode(mcpConfig) !== "exclusive") continue
        servers.push(name)
      }
      return servers
    })

    const createAndStore = Effect.fn("MCP.createAndStore")(function* (name: string, mcp: ConfigMCP.Info) {
      const s = yield* InstanceState.get(state)
      const result = yield* create(name, mcp)

      if (!result.mcpClient) {
        yield* closeClient(s, name)
        setRuntimeStatus(s, name, result.status, mcp)
        return result.status
      }

      return yield* storeClient(s, name, result.mcpClient, result.defs!, mcp.timeout, mcp)
    })

    const add = Effect.fn("MCP.add")(function* (name: string, mcp: ConfigMCP.Info) {
      yield* createAndStore(name, mcp)
      const s = yield* InstanceState.get(state)
      return { status: statusMapFromSharedRuntimes(s) }
    })

    const connect = Effect.fn("MCP.connect")(function* (name: string) {
      const mcp = yield* getMcpConfig(name)
      if (!mcp) {
        log.error("MCP config not found or invalid", { name })
        return
      }
      yield* createAndStore(name, { ...mcp, enabled: true })
    })

    const disconnect = Effect.fn("MCP.disconnect")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      yield* closeClient(s, name)
      setRuntimeStatus(s, name, { status: "disabled" })
    })

    const toolsForContext = Effect.fn("MCP.toolsForContext")(function* (context: ToolsContext) {
      const result: Record<string, Tool> = {}
      const s = yield* InstanceState.get(state)

      const cfg = yield* cfgSvc.get()
      const config = cfg.mcp ?? {}
      const defaultTimeout = cfg.experimental?.mcp_timeout

      const serverNames = new Set([
        ...Object.keys(config),
        ...connectedSharedRuntimes(s).map((runtime) => runtime.serverName),
      ])
      const bridge = yield* EffectBridge.make()
      const runtimes = (
        yield* Effect.forEach(
          Array.from(serverNames),
          (serverName) =>
            Effect.gen(function* () {
          const raw = config[serverName]
          const configured = raw && isMcpConfigured(raw) ? raw : undefined
          const mcpConfig = configured ?? sharedRuntime(s, serverName)?.config
              const runtime = yield* runtimeForContext(s, serverName, mcpConfig, context, bridge)
          if (runtime?.status.status !== "connected" || !runtime.client) return undefined
          return { runtime, mcpConfig }
            }),
          { concurrency: "unbounded" },
        )
      ).filter((item): item is RuntimeToolEntry => !!item)

      yield* Effect.forEach(
        runtimes,
        ({ runtime, mcpConfig }) =>
          Effect.gen(function* () {
            const clientName = runtime.serverName
            const client = runtime.client!

            const listed = runtime.defs
            if (!listed) {
              log.warn("missing cached tools for connected server", { clientName, runtimeKey: runtime.key })
              return
            }

            runtime.lastUsed = Date.now()
            const timeout = mcpConfig?.timeout ?? defaultTimeout
            for (const mcpTool of listed) {
              const mode = mcpConfig ? ConfigMCP.effectiveIsolationMode(mcpConfig) : "shared_serial"
              const shouldQueue =
                runtime.scope.type === "shared" &&
                mode === "shared_serial" &&
                !!context.graphSessionID &&
                !!context.nodeID

              result[sanitize(clientName) + "_" + sanitize(mcpTool.name)] = convertMcpTool(
                mcpTool,
                client,
                timeout,
                shouldQueue
                  ? ({ abort, execute }) =>
                      runSharedSerial({
                        serverName: clientName,
                        runtimeKey: runtime.key,
                        toolName: mcpTool.name,
                        context,
                        abort,
                        timeout: DEFAULT_QUEUE_TIMEOUT,
                        execute,
                      })
                  : undefined,
              )
            }
          }),
        { concurrency: "unbounded" },
      )
      return result
    })

    const tools = Effect.fn("MCP.tools")(function* () {
      return yield* toolsForContext({})
    })

    function collectFromConnected<T extends { name: string }>(
      s: State,
      listFn: (c: Client) => Promise<T[]>,
      label: string,
    ) {
      return Effect.forEach(
        connectedSharedRuntimes(s),
        (runtime) => {
          const clientName = runtime.serverName
          const client = runtime.client!
          runtime.lastUsed = Date.now()
          return fetchFromClient(clientName, client, listFn, label).pipe(
            Effect.map((items) => Object.entries(items ?? {})),
          )
        },
        { concurrency: "unbounded" },
      ).pipe(Effect.map((results) => Object.fromEntries<T & { client: string }>(results.flat())))
    }

    const prompts = Effect.fn("MCP.prompts")(function* () {
      const s = yield* InstanceState.get(state)
      return yield* collectFromConnected(s, (c) => c.listPrompts().then((r) => r.prompts), "prompts")
    })

    const resources = Effect.fn("MCP.resources")(function* () {
      const s = yield* InstanceState.get(state)
      return yield* collectFromConnected(s, (c) => c.listResources().then((r) => r.resources), "resources")
    })

    const withClient = Effect.fnUntraced(function* <A>(
      clientName: string,
      fn: (client: MCPClient) => Promise<A>,
      label: string,
      meta?: Record<string, unknown>,
    ) {
      const s = yield* InstanceState.get(state)
      const runtime = sharedRuntime(s, clientName)
      const client = runtime?.client
      if (!client) {
        log.warn(`client not found for ${label}`, { clientName })
        return undefined
      }
      runtime.lastUsed = Date.now()
      return yield* Effect.tryPromise({
        try: () => fn(client),
        catch: (e: any) => {
          log.error(`failed to ${label}`, { clientName, ...meta, error: e?.message })
          return e
        },
      }).pipe(Effect.orElseSucceed(() => undefined))
    })

    const getPrompt = Effect.fn("MCP.getPrompt")(function* (
      clientName: string,
      name: string,
      args?: Record<string, string>,
    ) {
      return yield* withClient(clientName, (client) => client.getPrompt({ name, arguments: args }), "getPrompt", {
        promptName: name,
      })
    })

    const readResource = Effect.fn("MCP.readResource")(function* (clientName: string, resourceUri: string) {
      return yield* withClient(clientName, (client) => client.readResource({ uri: resourceUri }), "readResource", {
        resourceUri,
      })
    })

    const getMcpConfig = Effect.fnUntraced(function* (mcpName: string) {
      const cfg = yield* cfgSvc.get()
      const mcpConfig = cfg.mcp?.[mcpName]
      if (!mcpConfig || !isMcpConfigured(mcpConfig)) return undefined
      return mcpConfig
    })

    const startAuth = Effect.fn("MCP.startAuth")(function* (mcpName: string) {
      const mcpConfig = yield* getMcpConfig(mcpName)
      if (!mcpConfig) throw new Error(`MCP server ${mcpName} not found or disabled`)
      if (mcpConfig.type !== "remote") throw new Error(`MCP server ${mcpName} is not a remote server`)
      if (mcpConfig.oauth === false) throw new Error(`MCP server ${mcpName} has OAuth explicitly disabled`)
      const url = remoteURL(mcpName, mcpConfig.url)
      if (!url) throw new Error(`Invalid MCP URL for "${mcpName}"`)

      // OAuth config is optional - if not provided, we'll use auto-discovery
      const oauthConfig = typeof mcpConfig.oauth === "object" ? mcpConfig.oauth : undefined

      // Start the callback server with custom redirectUri if configured
      yield* Effect.promise(() => McpOAuthCallback.ensureRunning(oauthConfig?.redirectUri))

      const oauthState = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
      yield* auth.updateOAuthState(mcpName, oauthState)
      let capturedUrl: URL | undefined
      const authProvider = new McpOAuthProvider(
        mcpName,
        mcpConfig.url,
        {
          clientId: oauthConfig?.clientId,
          clientSecret: oauthConfig?.clientSecret,
          scope: oauthConfig?.scope,
          redirectUri: oauthConfig?.redirectUri,
        },
        {
          onRedirect: async (url) => {
            capturedUrl = url
          },
        },
        auth,
      )

      const transport = new StreamableHTTPClientTransport(url, { authProvider })

      return yield* Effect.tryPromise({
        try: () => {
          const client = new Client({ name: "opencode", version: InstallationVersion })
          return client
            .connect(transport)
            .then(() => ({ authorizationUrl: "", oauthState, client }) satisfies AuthResult)
        },
        catch: (error) => error,
      }).pipe(
        Effect.catch((error) => {
          if (error instanceof UnauthorizedError && capturedUrl) {
            pendingOAuthTransports.set(mcpName, transport)
            return Effect.succeed({ authorizationUrl: capturedUrl.toString(), oauthState } satisfies AuthResult)
          }
          return Effect.die(error)
        }),
      )
    })

    const authenticate = Effect.fn("MCP.authenticate")(function* (mcpName: string) {
      const result = yield* startAuth(mcpName)
      if (!result.authorizationUrl) {
        const client = "client" in result ? result.client : undefined
        const mcpConfig = yield* getMcpConfig(mcpName)
        if (!mcpConfig) {
          yield* Effect.tryPromise(() => client?.close() ?? Promise.resolve()).pipe(Effect.ignore)
          return { status: "failed", error: "MCP config not found after auth" } as Status
        }

        const listed = client ? yield* defs(mcpName, client, mcpConfig.timeout) : undefined
        if (!client || !listed) {
          yield* Effect.tryPromise(() => client?.close() ?? Promise.resolve()).pipe(Effect.ignore)
          return { status: "failed", error: "Failed to get tools" } as Status
        }

        const s = yield* InstanceState.get(state)
        yield* auth.clearOAuthState(mcpName)
        return yield* storeClient(s, mcpName, client, listed, mcpConfig.timeout)
      }

      log.info("opening browser for oauth", { mcpName, url: result.authorizationUrl, state: result.oauthState })

      const callbackPromise = McpOAuthCallback.waitForCallback(result.oauthState, mcpName)

      yield* Effect.tryPromise(() => open(result.authorizationUrl)).pipe(
        Effect.flatMap((subprocess) =>
          Effect.callback<void, Error>((resume) => {
            const timer = setTimeout(() => resume(Effect.void), 500)
            subprocess.on("error", (err) => {
              clearTimeout(timer)
              resume(Effect.fail(err))
            })
            subprocess.on("exit", (code) => {
              if (code !== null && code !== 0) {
                clearTimeout(timer)
                resume(Effect.fail(new Error(`Browser open failed with exit code ${code}`)))
              }
            })
          }),
        ),
        Effect.catch(() => {
          log.warn("failed to open browser, user must open URL manually", { mcpName })
          return bus.publish(BrowserOpenFailed, { mcpName, url: result.authorizationUrl }).pipe(Effect.ignore)
        }),
      )

      const code = yield* Effect.promise(() => callbackPromise)

      const storedState = yield* auth.getOAuthState(mcpName)
      if (storedState !== result.oauthState) {
        yield* auth.clearOAuthState(mcpName)
        throw new Error("OAuth state mismatch - potential CSRF attack")
      }
      yield* auth.clearOAuthState(mcpName)
      return yield* finishAuth(mcpName, code)
    })

    const finishAuth = Effect.fn("MCP.finishAuth")(function* (mcpName: string, authorizationCode: string) {
      const transport = pendingOAuthTransports.get(mcpName)
      if (!transport) throw new Error(`No pending OAuth flow for MCP server: ${mcpName}`)

      const result = yield* Effect.tryPromise({
        try: () => transport.finishAuth(authorizationCode).then(() => true as const),
        catch: (error) => {
          log.error("failed to finish oauth", { mcpName, error })
          return error
        },
      }).pipe(Effect.option)

      if (Option.isNone(result)) {
        return { status: "failed", error: "OAuth completion failed" } as Status
      }

      yield* auth.clearCodeVerifier(mcpName)
      pendingOAuthTransports.delete(mcpName)

      const mcpConfig = yield* getMcpConfig(mcpName)
      if (!mcpConfig) return { status: "failed", error: "MCP config not found after auth" } as Status

      return yield* createAndStore(mcpName, mcpConfig)
    })

    const removeAuth = Effect.fn("MCP.removeAuth")(function* (mcpName: string) {
      yield* auth.remove(mcpName)
      McpOAuthCallback.cancelPending(mcpName)
      pendingOAuthTransports.delete(mcpName)
      log.info("removed oauth credentials", { mcpName })
    })

    const supportsOAuth = Effect.fn("MCP.supportsOAuth")(function* (mcpName: string) {
      const mcpConfig = yield* getMcpConfig(mcpName)
      if (!mcpConfig) return false
      return mcpConfig.type === "remote" && mcpConfig.oauth !== false
    })

    const hasStoredTokens = Effect.fn("MCP.hasStoredTokens")(function* (mcpName: string) {
      const entry = yield* auth.get(mcpName)
      return !!entry?.tokens
    })

    const getAuthStatus = Effect.fn("MCP.getAuthStatus")(function* (mcpName: string) {
      const entry = yield* auth.get(mcpName)
      if (!entry?.tokens) return "not_authenticated" as AuthStatus
      const expired = yield* auth.isTokenExpired(mcpName)
      return (expired ? "expired" : "authenticated") as AuthStatus
    })

    return Service.of({
      status,
      clients,
      tools,
      toolsForContext,
      exclusiveServers,
      prompts,
      resources,
      add,
      connect,
      disconnect,
      getPrompt,
      readResource,
      startAuth,
      authenticate,
      finishAuth,
      removeAuth,
      supportsOAuth,
      hasStoredTokens,
      getAuthStatus,
    })
  }),
)

export type AuthStatus = "authenticated" | "expired" | "not_authenticated"

// --- Per-service runtime ---

export const defaultLayer = layer.pipe(
  Layer.provide(McpAuth.layer),
  Layer.provide(Bus.layer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(CrossSpawnSpawner.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
)

export * as MCP from "."
