/**
 * MCP Apps (SEP-1865) contract tests — mirrors the checks an MCP Apps host
 * performs to render the appliance card:
 *   1. renderable tools advertise the UI resource via _meta
 *   2. the ui:// resource lists and reads back as profile=mcp-app HTML
 *   3. unitrends_get_appliance results carry the normalized `_card` payload
 *      the iframe renders from
 *
 * Wire-level checks drive the real Server over an in-memory transport pair
 * (the same Server the stdio and HTTP transports connect in production);
 * buildApplianceCard is unit-tested directly.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp-server.js";
import {
  applyBrandInjection,
  buildApplianceCard,
  resolveBrandFromEnv,
  APPLIANCE_CARD_RESOURCE_URI,
  MCP_APP_RESOURCE_MIME,
} from "../src/appliance-card.js";
import { APPLIANCE_CARD_HTML } from "../src/generated/appliance-card-html.js";

const mockAppliances: Array<Record<string, unknown>> = [];

vi.mock("@wyre-technology/node-unitrends", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@wyre-technology/node-unitrends")>();
  return {
    ...actual,
    UnitrendsClient: class {
      appliances = {
        listAll: () =>
          (async function* () {
            yield* mockAppliances;
          })(),
      };
    },
  };
});

const TEST_CREDS = {
  baseUrl: "https://unitrends.test.local",
  username: "test",
  password: "test",
};

async function connect(): Promise<Client> {
  const server = createMcpServer(TEST_CREDS);
  const client = new Client({ name: "mcp-apps-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const RENDERABLE_TOOLS = ["unitrends_get_appliance"];

const onlineAppliance = {
  id: "appl-01",
  name: "Recovery-943",
  hostname: "ub-hq-01.example.com",
  version: "10.9.2",
  model: "Recovery Series 943",
  status: "online",
  assetCount: 42,
};

describe("MCP Apps appliance card", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mockAppliances.length = 0;
  });

  describe("tool _meta advertisement", () => {
    it.each(RENDERABLE_TOOLS)("%s links the card via _meta", async (name) => {
      const client = await connect();
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === name);
      expect(tool).toBeDefined();
      // Canonical flat key (ext-apps RESOURCE_URI_META_KEY) …
      expect(tool?._meta?.["ui/resourceUri"]).toBe(APPLIANCE_CARD_RESOURCE_URI);
      // … and the nested form registerAppTool also emits.
      expect((tool?._meta?.ui as { resourceUri?: string })?.resourceUri).toBe(
        APPLIANCE_CARD_RESOURCE_URI
      );
      await client.close();
    });

    it("no other tools carry UI metadata", async () => {
      const client = await connect();
      const { tools } = await client.listTools();
      const others = tools.filter(
        (t) => t._meta && !RENDERABLE_TOOLS.includes(t.name)
      );
      expect(others).toEqual([]);
      await client.close();
    });
  });

  describe("ui:// resource", () => {
    it("is listed with the MCP Apps MIME type", async () => {
      const client = await connect();
      const { resources } = await client.listResources();
      const card = resources.find((r) => r.uri === APPLIANCE_CARD_RESOURCE_URI);
      expect(card?.mimeType).toBe(MCP_APP_RESOURCE_MIME);
      await client.close();
    });

    it("reads back as profile=mcp-app HTML containing the card app", async () => {
      const client = await connect();
      const { contents } = await client.readResource({
        uri: APPLIANCE_CARD_RESOURCE_URI,
      });
      const content = contents[0];
      expect(content?.mimeType).toBe(MCP_APP_RESOURCE_MIME);
      // No MCP_BRAND_* env set → the embedded HTML is served byte-identical.
      expect(content?.text).toBe(APPLIANCE_CARD_HTML);
      expect(content?.text).toContain("card__bar");
      // The brand-inject marker survives the vite build — and exactly once,
      // so serve-time injection has an unambiguous replacement target.
      expect((APPLIANCE_CARD_HTML.match(/BRAND_INJECT/g) ?? []).length).toBe(1);
      // The vite build must have inlined the bridge script — a bare <script src>
      // would be unloadable from a resources/read HTML string.
      expect(content?.text).not.toContain('src="./appliance-card.ts"');
      await client.close();
    });

    it("serves neutral defaults with no vendor identity or external fetches", () => {
      expect(APPLIANCE_CARD_HTML).not.toMatch(/WYRE/i);
      expect(APPLIANCE_CARD_HTML).not.toContain("00c9db"); // WYRE cyan
      expect(APPLIANCE_CARD_HTML).not.toContain("ede947"); // WYRE yellow
      expect(APPLIANCE_CARD_HTML).not.toContain("fonts.googleapis.com");
    });

    it("injects MCP_BRAND_* env vars into the served HTML", async () => {
      vi.stubEnv("MCP_BRAND_NAME", "Acme MSP");
      vi.stubEnv("MCP_BRAND_PRIMARY_COLOR", "#ff0000");
      const client = await connect();
      const { contents } = await client.readResource({
        uri: APPLIANCE_CARD_RESOURCE_URI,
      });
      const text = (contents[0]?.text as string) ?? "";
      expect(text).toContain(
        '<script>window.__BRAND__={"name":"Acme MSP","primaryColor":"#ff0000"}</script>'
      );
      expect(text).not.toContain("BRAND_INJECT");
      await client.close();
    });

    it("rejects unknown resource URIs", async () => {
      const client = await connect();
      await expect(
        client.readResource({ uri: "ui://unitrends/nope.html" })
      ).rejects.toThrow(/Unknown resource/);
      await client.close();
    });
  });

  describe("unitrends_get_appliance result", () => {
    it("carries the normalized _card payload alongside the raw appliance", async () => {
      mockAppliances.push(onlineAppliance);
      const client = await connect();
      const result = (await client.callTool({
        name: "unitrends_get_appliance",
        arguments: { applianceId: "appl-01" },
      })) as { isError?: boolean; content?: Array<{ text?: string }> };
      expect(result.isError).toBeFalsy();
      const payload = JSON.parse(result.content?.[0]?.text ?? "{}");
      expect(payload.id).toBe("appl-01");
      expect(payload.assetCount).toBe(42);
      expect(payload._card).toEqual({
        applianceId: "appl-01",
        name: "Recovery-943",
        hostname: "ub-hq-01.example.com",
        model: "Recovery Series 943",
        version: "10.9.2",
        status: "Online",
      });
      await client.close();
    });

    it("returns an explicit error when the appliance is not found", async () => {
      const client = await connect();
      const result = (await client.callTool({
        name: "unitrends_get_appliance",
        arguments: { applianceId: "appl-missing" },
      })) as { isError?: boolean; content?: Array<{ text?: string }> };
      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.text).toContain("appl-missing not found");
      await client.close();
    });
  });

  describe("applyBrandInjection", () => {
    it("replaces the marker with an inline window.__BRAND__ script", () => {
      const out = applyBrandInjection(APPLIANCE_CARD_HTML, {
        name: "Acme MSP",
        primaryColor: "#ff0000",
      });
      expect(out).not.toContain("BRAND_INJECT");
      expect(out).toContain(
        'window.__BRAND__={"name":"Acme MSP","primaryColor":"#ff0000"}'
      );
    });

    it("escapes < so brand values cannot break out of the script tag", () => {
      const out = applyBrandInjection(APPLIANCE_CARD_HTML, {
        name: "</script><script>alert(1)",
      });
      expect(out).not.toContain("</script><script>alert(1)");
      expect(out).toContain("\\u003c/script");
    });

    it("returns the HTML unchanged (byte-identical) for an empty brand", () => {
      expect(applyBrandInjection(APPLIANCE_CARD_HTML, {})).toBe(APPLIANCE_CARD_HTML);
      expect(applyBrandInjection(APPLIANCE_CARD_HTML, { name: "" })).toBe(
        APPLIANCE_CARD_HTML
      );
    });
  });

  describe("resolveBrandFromEnv", () => {
    it("maps MCP_BRAND_* vars and ignores everything else", () => {
      expect(
        resolveBrandFromEnv({
          MCP_BRAND_NAME: "Acme MSP",
          MCP_BRAND_LOGO_URL: "https://cdn.acme.test/logo.svg",
          MCP_BRAND_PRIMARY_COLOR: "#ff0000",
          MCP_BRAND_ACCENT_COLOR: "#00ff00",
          MCP_BRAND_BG: "#ffffff",
          MCP_BRAND_TEXT: "#111111",
          UNITRENDS_USERNAME: "not-a-brand",
        })
      ).toEqual({
        name: "Acme MSP",
        logoUrl: "https://cdn.acme.test/logo.svg",
        primaryColor: "#ff0000",
        accentColor: "#00ff00",
        bg: "#ffffff",
        text: "#111111",
      });
      expect(resolveBrandFromEnv({})).toEqual({});
      expect(resolveBrandFromEnv(undefined)).toEqual({});
    });
  });

  describe("buildApplianceCard", () => {
    it("normalizes a full appliance", () => {
      expect(buildApplianceCard(onlineAppliance)).toEqual({
        applianceId: "appl-01",
        name: "Recovery-943",
        hostname: "ub-hq-01.example.com",
        model: "Recovery Series 943",
        version: "10.9.2",
        status: "Online",
      });
    });

    it("falls back to hostname, then id, for the display name", () => {
      expect(
        buildApplianceCard({ id: "appl-02", hostname: "ub-02.example.com" })?.name
      ).toBe("ub-02.example.com");
      expect(buildApplianceCard({ id: "appl-03" })?.name).toBe("appl-03");
    });

    it("survives sparse appliances (card is best-effort)", () => {
      expect(buildApplianceCard({ id: "appl-04" })).toEqual({
        applianceId: "appl-04",
        name: "appl-04",
      });
    });

    it("returns null for payloads that are not an appliance", () => {
      expect(buildApplianceCard(undefined)).toBeNull();
      expect(buildApplianceCard(null)).toBeNull();
      expect(buildApplianceCard({} as never)).toBeNull();
      expect(buildApplianceCard({ id: "" } as never)).toBeNull();
    });
  });
});
