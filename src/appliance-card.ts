/**
 * Appliance-card payload builder for the MCP Apps (SEP-1865) UI surface.
 *
 * unitrends_get_appliance results get a normalized `_card` object attached
 * (see mcp-server.ts) that the ui:// appliance card renders from. The card is
 * progressive enhancement: normalization is best-effort, and a null return
 * simply means the host renders no card while the JSON payload is unchanged.
 */

import type { Appliance } from "@wyre-technology/node-unitrends";

export const APPLIANCE_CARD_RESOURCE_URI = "ui://unitrends/appliance-card.html";

/** MCP Apps resource MIME (RESOURCE_MIME_TYPE in @modelcontextprotocol/ext-apps). */
export const MCP_APP_RESOURCE_MIME = "text/html;profile=mcp-app";

/**
 * Tool `_meta` advertising the card. Carries both the canonical flat key
 * (RESOURCE_URI_META_KEY in ext-apps) and the nested form ext-apps'
 * registerAppTool emits, so any MCP Apps host revision finds it.
 */
export const APPLIANCE_CARD_META = {
  "ui/resourceUri": APPLIANCE_CARD_RESOURCE_URI,
  ui: { resourceUri: APPLIANCE_CARD_RESOURCE_URI },
} as const;

/** Mirror of ApplianceCard in ui/appliance-card.ts — keep in sync. */
export interface ApplianceCard {
  applianceId: string;
  /** Display title: name, falling back to hostname, falling back to the id. */
  name: string;
  hostname?: string;
  model?: string;
  version?: string;
  status?: string;
}

/** Brand overrides injected into the card as `window.__BRAND__`. */
export interface CardBrand {
  name?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  bg?: string;
  text?: string;
}

/** The comment marker in ui/index.html that serve-time injection replaces. */
const BRAND_INJECT_MARKER = /<!-- BRAND_INJECT:[\s\S]*?-->/;

/**
 * Replace the card's brand-inject comment marker with a `window.__BRAND__`
 * script. The card ships neutral; this is the customization mechanism. An
 * empty brand returns the HTML unchanged (byte-identical). `<` is escaped so
 * brand values can never break out of the injected script tag.
 */
export function applyBrandInjection(html: string, brand: CardBrand): string {
  const entries = Object.entries(brand).filter(
    ([, value]) => typeof value === "string" && value !== ""
  );
  if (entries.length === 0) return html;
  const json = JSON.stringify(Object.fromEntries(entries)).replace(/</g, "\\u003c");
  return html.replace(BRAND_INJECT_MARKER, `<script>window.__BRAND__=${json}</script>`);
}

/**
 * Resolve brand overrides from MCP_BRAND_* environment variables. Returns
 * an empty brand (HTML served unchanged) when none are set, or on runtimes
 * without `process.env`.
 */
export function resolveBrandFromEnv(
  env: Record<string, string | undefined> | undefined = typeof process !== "undefined"
    ? process.env
    : undefined
): CardBrand {
  if (!env) return {};
  const brand: CardBrand = {};
  if (env.MCP_BRAND_NAME) brand.name = env.MCP_BRAND_NAME;
  if (env.MCP_BRAND_LOGO_URL) brand.logoUrl = env.MCP_BRAND_LOGO_URL;
  if (env.MCP_BRAND_PRIMARY_COLOR) brand.primaryColor = env.MCP_BRAND_PRIMARY_COLOR;
  if (env.MCP_BRAND_ACCENT_COLOR) brand.accentColor = env.MCP_BRAND_ACCENT_COLOR;
  if (env.MCP_BRAND_BG) brand.bg = env.MCP_BRAND_BG;
  if (env.MCP_BRAND_TEXT) brand.text = env.MCP_BRAND_TEXT;
  return brand;
}

/**
 * Normalize an SDK Appliance into the flat, label-resolved payload the ui://
 * appliance card renders from. Appliances carry no foreign keys, so no extra
 * lookups are needed — this only flattens and tidies what the API returned.
 */
export function buildApplianceCard(
  appliance: Partial<Appliance> | null | undefined
): ApplianceCard | null {
  if (!appliance || typeof appliance.id !== "string" || appliance.id === "") {
    return null;
  }

  const card: ApplianceCard = {
    applianceId: appliance.id,
    name: appliance.name || appliance.hostname || appliance.id,
  };

  if (typeof appliance.hostname === "string" && appliance.hostname) {
    card.hostname = appliance.hostname;
  }
  if (typeof appliance.model === "string" && appliance.model) {
    card.model = appliance.model;
  }
  if (typeof appliance.version === "string" && appliance.version) {
    card.version = appliance.version;
  }
  if (typeof appliance.status === "string" && appliance.status) {
    card.status = appliance.status.charAt(0).toUpperCase() + appliance.status.slice(1);
  }

  return card;
}
