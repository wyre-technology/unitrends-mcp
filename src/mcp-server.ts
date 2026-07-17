/**
 * Unitrends MCP server factory.
 *
 * Builds a fully-wired MCP Server (tools + MCP Apps resources) for a set of
 * credentials. The transports live in index.ts; HTTP mode creates a fresh
 * server per request (stateless), so everything request-scoped lives here.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { UnitrendsClient, type Appliance } from "@wyre-technology/node-unitrends";
import { setServerRef } from "./utils/server-ref.js";
import { elicitConfirmation, elicitSelection, elicitText } from "./utils/elicitation.js";
import {
  APPLIANCE_CARD_META,
  APPLIANCE_CARD_RESOURCE_URI,
  MCP_APP_RESOURCE_MIME,
  applyBrandInjection,
  buildApplianceCard,
  resolveBrandFromEnv,
} from "./appliance-card.js";
import { APPLIANCE_CARD_HTML } from "./generated/appliance-card-html.js";

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export interface UnitrendsCredentials {
  baseUrl: string;
  username: string;
  password: string;
  verifyTls?: boolean;
}

export function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return !["false", "0", "no", "off"].includes(value.trim().toLowerCase());
}

export function getCredentials(): UnitrendsCredentials | null {
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

export function createMcpServer(credentialOverrides?: UnitrendsCredentials): Server {
  const server = new Server(
    {
      name: "unitrends-mcp",
      version: "0.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
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
          name: "unitrends_get_appliance",
          description:
            "Get details for a single Unitrends appliance by its identifier. Only returns data when pointed at the MSP Console; single-appliance deployments do not expose this endpoint.",
          _meta: APPLIANCE_CARD_META,
          inputSchema: {
            type: "object",
            properties: {
              applianceId: {
                type: "string",
                description: "Appliance identifier",
              },
            },
            required: ["applianceId"],
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

  // MCP Apps (SEP-1865): the ui:// appliance card is static HTML embedded at
  // build time (src/generated/appliance-card-html.ts), so it serves
  // identically from stdio and Node HTTP without touching the filesystem.
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: APPLIANCE_CARD_RESOURCE_URI,
          name: "Unitrends Appliance Card",
          description: "Interactive MCP Apps card rendering a Unitrends appliance's status",
          mimeType: MCP_APP_RESOURCE_MIME,
        },
      ],
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    if (uri !== APPLIANCE_CARD_RESOURCE_URI) {
      throw new Error(`Unknown resource: ${uri}`);
    }
    return {
      contents: [
        {
          uri,
          mimeType: MCP_APP_RESOURCE_MIME,
          // The card ships neutral; operators brand it at serve time via
          // MCP_BRAND_* env vars (no vars = HTML served unchanged).
          text: applyBrandInjection(APPLIANCE_CARD_HTML, resolveBrandFromEnv()),
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

  /** Find a single appliance by id (the SDK only exposes list endpoints). */
  async function findAppliance(
    client: UnitrendsClient,
    applianceId: string
  ): Promise<Appliance | undefined> {
    for await (const appliance of client.appliances.listAll()) {
      if (appliance.id === applianceId) return appliance;
    }
    return undefined;
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

        case "unitrends_get_appliance": {
          const { applianceId } = args as { applianceId: string };
          const appliance = await findAppliance(client, applianceId);
          if (!appliance) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: Appliance ${applianceId} not found. Appliances are only visible when connected to an MSP Console — use unitrends_list_appliances to see valid identifiers.`,
                },
              ],
              isError: true,
            };
          }
          // MCP Apps: attach the normalized payload the ui:// appliance card
          // renders from. Best-effort — a null card just means no UI surface.
          const card = buildApplianceCard(appliance);
          const payload = card ? { ...appliance, _card: card } : appliance;
          return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
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
          // SDK uses listHistory + JobListParams (no since/until inline at SDK
          // level — date filtering is applied client-side in the same way as
          // datto-bcdr-mcp does for alerts/activity). For now we just paginate
          // the most recent page; date-window filtering can be layered in a
          // follow-up if Unitrends adds query params.
          void range;
          const history = await client.jobs.listHistory();
          return { content: [{ type: "text", text: JSON.stringify(history ?? [], null, 2) }] };
        }

        case "unitrends_list_recovery_points": {
          const { assetId, applianceId } = args as { assetId: string; applianceId?: string };
          const points = await client.recoveryPoints.list({ assetId, applianceId });
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
          // The SDK's SuccessRateParams uses startTime/endTime as Unix epoch
          // seconds (Unitrends convention) — convert from the resolved range.
          const toEpochSeconds = (s: string | undefined): number | undefined =>
            s ? Math.floor(new Date(s).getTime() / 1000) : undefined;
          const report = await client.reports.successRate({
            startTime: toEpochSeconds(range.since),
            endTime: toEpochSeconds(range.until),
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
