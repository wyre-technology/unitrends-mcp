#!/usr/bin/env node
/**
 * Unitrends MCP Server
 *
 * Exposes the Unitrends Backup API to Claude and other MCP clients.
 * Accepts credentials via environment variables (env mode) or per-request
 * HTTP headers (gateway mode).
 *
 * Supports both stdio (default) and HTTP (StreamableHTTP) transports.
 */

import { createServer, IncomingMessage, ServerResponse, Server as HttpServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { UnitrendsClient } from "@wyre-technology/node-unitrends";
import { setServerRef } from "./utils/server-ref.js";
import { elicitConfirmation, elicitSelection, elicitText } from "./utils/elicitation.js";

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

interface UnitrendsCredentials {
  baseUrl: string;
  username: string;
  password: string;
  verifyTls?: boolean;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return !["false", "0", "no", "off"].includes(value.trim().toLowerCase());
}

function getCredentials(): UnitrendsCredentials | null {
  const baseUrl = process.env.UNITRENDS_BASE_URL;
  const username = process.env.UNITRENDS_USERNAME;
  const password = process.env.UNITRENDS_PASSWORD;
  if (!baseUrl || !username || !password) return null;
  return {
    baseUrl,
    username,
    password,
    verifyTls: parseBool(process.env.UNITRENDS_VERIFY_TLS, true),
  };
}

function createClient(creds: UnitrendsCredentials): UnitrendsClient {
  return new UnitrendsClient({
    baseUrl: creds.baseUrl,
    username: creds.username,
    password: creds.password,
    verifyTls: creds.verifyTls ?? true,
  });
}

// ---------------------------------------------------------------------------
// Server factory — fresh server per request (stateless HTTP mode)
// ---------------------------------------------------------------------------

function createMcpServer(credentialOverrides?: UnitrendsCredentials): Server {
  const server = new Server(
    {
      name: "unitrends-mcp",
      version: "0.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  setServerRef(server);

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "unitrends_list_appliances",
          description:
            "List Unitrends appliances visible to the connected MSP Console. Only returns data when pointed at the MSP Console; single-appliance deployments return an empty list.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "unitrends_list_assets",
          description:
            "List protected assets (machines / agents) on a Unitrends appliance. If applianceId is omitted and an MSP Console is in use, the user will be prompted to pick one.",
          inputSchema: {
            type: "object",
            properties: {
              applianceId: {
                type: "string",
                description: "Appliance identifier (optional — will elicit if omitted)",
              },
            },
          },
        },
        {
          name: "unitrends_get_asset",
          description: "Fetch details for a single protected asset.",
          inputSchema: {
            type: "object",
            properties: {
              applianceId: { type: "string", description: "Appliance identifier" },
              assetId: { type: "string", description: "Asset identifier" },
            },
            required: ["applianceId", "assetId"],
          },
        },
        {
          name: "unitrends_list_running_jobs",
          description: "List currently running and queued backup jobs.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "unitrends_list_job_history",
          description:
            "List historical backup jobs. If date range is omitted, the user will be prompted to choose a window.",
          inputSchema: {
            type: "object",
            properties: {
              since: { type: "string", description: "ISO 8601 start datetime (optional)" },
              until: { type: "string", description: "ISO 8601 end datetime (optional)" },
            },
          },
        },
        {
          name: "unitrends_list_recovery_points",
          description: "List recovery points (backups) available for an asset.",
          inputSchema: {
            type: "object",
            properties: {
              assetId: { type: "string", description: "Asset identifier" },
            },
            required: ["assetId"],
          },
        },
        {
          name: "unitrends_queue_restore",
          description:
            "Queue a restore from a recovery point. DESTRUCTIVE: writes data back into the target asset. Requires explicit confirmation.",
          inputSchema: {
            type: "object",
            properties: {
              recoveryPointId: { type: "string", description: "Recovery point identifier to restore from" },
              targetAssetId: { type: "string", description: "Target asset identifier (defaults to source if omitted)" },
              targetPath: { type: "string", description: "Optional restore destination path" },
            },
            required: ["recoveryPointId"],
          },
        },
        {
          name: "unitrends_get_restore_status",
          description: "Check the status / progress of a queued restore.",
          inputSchema: {
            type: "object",
            properties: {
              restoreId: { type: "string", description: "Restore job identifier" },
            },
            required: ["restoreId"],
          },
        },
        {
          name: "unitrends_list_alerts",
          description: "List open alarms / alerts on the appliance.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "unitrends_get_success_rate",
          description:
            "Get RPO compliance / backup success-rate report. If date range is omitted, the user will be prompted.",
          inputSchema: {
            type: "object",
            properties: {
              since: { type: "string", description: "ISO 8601 start datetime (optional)" },
              until: { type: "string", description: "ISO 8601 end datetime (optional)" },
            },
          },
        },
      ],
    };
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  interface DateRange {
    since?: string;
    until?: string;
  }

  async function resolveDateRange(args: DateRange): Promise<DateRange> {
    if (args.since || args.until) return args;

    const choice = await elicitSelection(
      "No date range provided. This query can return many results. Choose a window:",
      "range",
      [
        { value: "24h", label: "Last 24 hours" },
        { value: "7d", label: "Last 7 days" },
        { value: "30d", label: "Last 30 days" },
        { value: "custom", label: "Enter custom ISO 8601 dates" },
        { value: "all", label: "No filter (return everything)" },
      ]
    );

    const nowMs = Date.now();
    const PRESET_WINDOWS_MS: Record<string, number> = {
      "24h": 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000,
    };
    if (!choice || choice === "all") return {};
    if (choice in PRESET_WINDOWS_MS) {
      return { since: new Date(nowMs - PRESET_WINDOWS_MS[choice]).toISOString() };
    }
    if (choice === "custom") {
      const since = await elicitText(
        "Enter the start datetime in ISO 8601 format (e.g. 2025-04-01T00:00:00Z).",
        "since",
        "Start datetime"
      );
      const until = await elicitText(
        "Enter the end datetime in ISO 8601 format (leave blank for now).",
        "until",
        "End datetime"
      );
      return { since: since ?? undefined, until: until ?? undefined };
    }
    return {};
  }

  async function resolveApplianceId(
    client: UnitrendsClient,
    provided?: string
  ): Promise<string | undefined> {
    if (provided) return provided;

    try {
      const result = await client.appliances.list();
      const items: Array<{ id: string; name?: string }> = Array.isArray(
        (result as { items?: unknown }).items
      )
        ? ((result as { items: Array<{ id: string; name?: string }> }).items)
        : (Array.isArray(result) ? (result as Array<{ id: string; name?: string }>) : []);

      if (items.length === 0) return undefined;
      if (items.length === 1) return items[0].id;

      const options = items.slice(0, 25).map((a) => ({
        value: a.id,
        label: a.name ? `${a.name} (${a.id})` : a.id,
      }));
      const picked = await elicitSelection("Select an appliance:", "applianceId", options);
      return picked ?? undefined;
    } catch {
      return undefined;
    }
  }

  // -------------------------------------------------------------------------
  // Tool call handler
  // -------------------------------------------------------------------------

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const creds = credentialOverrides ?? getCredentials();

    if (!creds) {
      return {
        content: [
          {
            type: "text",
            text:
              "Error: No Unitrends credentials provided. Please configure UNITRENDS_BASE_URL, UNITRENDS_USERNAME, and UNITRENDS_PASSWORD environment variables (UNITRENDS_VERIFY_TLS optional, default true), or pass them as gateway headers.",
          },
        ],
        isError: true,
      };
    }

    const client = createClient(creds);

    try {
      switch (name) {
        case "unitrends_list_appliances": {
          const result = await client.appliances.list();
          return { content: [{ type: "text", text: JSON.stringify(result ?? [], null, 2) }] };
        }

        case "unitrends_list_assets": {
          const params = (args ?? {}) as { applianceId?: string };
          const applianceId = await resolveApplianceId(client, params.applianceId);
          const assets = await client.assets.list(applianceId ? { applianceId } : {});
          return { content: [{ type: "text", text: JSON.stringify(assets ?? [], null, 2) }] };
        }

        case "unitrends_get_asset": {
          const { applianceId, assetId } = args as { applianceId: string; assetId: string };
          const asset = await client.assets.get(applianceId, assetId);
          return { content: [{ type: "text", text: JSON.stringify(asset ?? {}, null, 2) }] };
        }

        case "unitrends_list_running_jobs": {
          const jobs = await client.jobs.listBackups();
          return { content: [{ type: "text", text: JSON.stringify(jobs ?? [], null, 2) }] };
        }

        case "unitrends_list_job_history": {
          const params = (args ?? {}) as DateRange;
          const range = await resolveDateRange(params);
          const history = await client.jobs.history({ since: range.since, until: range.until });
          return { content: [{ type: "text", text: JSON.stringify(history ?? [], null, 2) }] };
        }

        case "unitrends_list_recovery_points": {
          const { assetId } = args as { assetId: string };
          const points = await client.recoveryPoints.list(assetId);
          return { content: [{ type: "text", text: JSON.stringify(points ?? [], null, 2) }] };
        }

        case "unitrends_queue_restore": {
          const { recoveryPointId, targetAssetId, targetPath } = args as {
            recoveryPointId: string;
            targetAssetId?: string;
            targetPath?: string;
          };
          const confirmed = await elicitConfirmation(
            `About to QUEUE A RESTORE from recovery point ${recoveryPointId}` +
              (targetAssetId ? ` to asset ${targetAssetId}` : "") +
              (targetPath ? ` at path ${targetPath}` : "") +
              ".\n\nThis writes data back into the target system, which can " +
              "overwrite existing files and disrupt running services.\n\nProceed?"
          );
          if (confirmed !== true) {
            return {
              content: [
                {
                  type: "text",
                  text:
                    confirmed === null
                      ? "Restore cancelled: client does not support confirmation prompts. Pass an explicit confirm flag from a different client to proceed."
                      : "Restore cancelled by user.",
                },
              ],
              isError: true,
            };
          }
          const restore = await client.restores.queue({
            recoveryPointId,
            targetAssetId,
            targetPath,
          });
          return { content: [{ type: "text", text: JSON.stringify(restore ?? {}, null, 2) }] };
        }

        case "unitrends_get_restore_status": {
          const { restoreId } = args as { restoreId: string };
          const status = await client.restores.get(restoreId);
          return { content: [{ type: "text", text: JSON.stringify(status ?? {}, null, 2) }] };
        }

        case "unitrends_list_alerts": {
          const alerts = await client.alerts.list();
          return { content: [{ type: "text", text: JSON.stringify(alerts ?? [], null, 2) }] };
        }

        case "unitrends_get_success_rate": {
          const params = (args ?? {}) as DateRange;
          const range = await resolveDateRange(params);
          const report = await client.reports.successRate({
            since: range.since,
            until: range.until,
          });
          return { content: [{ type: "text", text: JSON.stringify(report ?? {}, null, 2) }] };
        }

        default:
          return {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

// ---------------------------------------------------------------------------
// Transport: stdio (default)
// ---------------------------------------------------------------------------

async function startStdioTransport(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Unitrends MCP server running on stdio");
}

// ---------------------------------------------------------------------------
// Transport: HTTP (StreamableHTTPServerTransport)
// ---------------------------------------------------------------------------

let httpServer: HttpServer | undefined;

async function startHttpTransport(): Promise<void> {
  const port = parseInt(process.env.MCP_HTTP_PORT || "8080", 10);
  const host = process.env.MCP_HTTP_HOST || "0.0.0.0";
  const authMode = process.env.AUTH_MODE || "env";
  const isGatewayMode = authMode === "gateway";

  httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    // Health endpoint - no auth required
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          transport: "http",
          authMode: isGatewayMode ? "gateway" : "env",
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    if (url.pathname === "/mcp") {
      if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Method not allowed" },
            id: null,
          })
        );
        return;
      }

      // In gateway mode, extract credentials from headers and pass directly
      // to avoid process.env race conditions under concurrent load.
      let gatewayCredentials: UnitrendsCredentials | undefined;
      if (isGatewayMode) {
        const headers = req.headers as Record<string, string | string[] | undefined>;
        const baseUrl = headers["x-unitrends-base-url"] as string | undefined;
        const username = headers["x-unitrends-username"] as string | undefined;
        const password = headers["x-unitrends-password"] as string | undefined;
        const verifyTlsRaw = headers["x-unitrends-verify-tls"] as string | undefined;

        const missing: string[] = [];
        if (!baseUrl) missing.push("X-Unitrends-Base-URL");
        if (!username) missing.push("X-Unitrends-Username");
        if (!password) missing.push("X-Unitrends-Password");

        if (missing.length > 0) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Missing credentials",
              message:
                "Gateway mode requires X-Unitrends-Base-URL, X-Unitrends-Username, and X-Unitrends-Password headers (X-Unitrends-Verify-TLS optional, default true)",
              required: missing,
            })
          );
          return;
        }

        gatewayCredentials = {
          baseUrl: baseUrl!,
          username: username!,
          password: password!,
          verifyTls: parseBool(verifyTlsRaw, true),
        };
      }

      // Stateless: fresh server + transport per request
      const server = createMcpServer(gatewayCredentials);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      res.on("close", () => {
        transport.close();
        server.close();
      });

      server
        .connect(transport as unknown as Transport)
        .then(() => {
          transport.handleRequest(req, res);
        })
        .catch((err) => {
          console.error("MCP transport error:", err);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32603, message: "Internal error" },
                id: null,
              })
            );
          }
        });

      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found", endpoints: ["/mcp", "/health"] }));
  });

  await new Promise<void>((resolve) => {
    httpServer!.listen(port, host, () => {
      console.error(`Unitrends MCP server listening on http://${host}:${port}/mcp`);
      console.error(`Health check available at http://${host}:${port}/health`);
      console.error(
        `Authentication mode: ${isGatewayMode ? "gateway (header-based)" : "env (environment variables)"}`
      );
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function setupShutdownHandlers(): void {
  const shutdown = async () => {
    console.error("Shutting down Unitrends MCP server...");
    if (httpServer) {
      await new Promise<void>((resolve, reject) => {
        httpServer!.close((err) => (err ? reject(err) : resolve()));
      });
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  setupShutdownHandlers();

  const transportType = process.env.MCP_TRANSPORT || "stdio";

  if (transportType === "http") {
    await startHttpTransport();
  } else {
    await startStdioTransport();
  }
}

main().catch(console.error);
