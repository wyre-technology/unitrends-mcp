/**
 * Iframe bridge + renderer for the Unitrends appliance card (MCP Apps,
 * SEP-1865).
 *
 * Runs inside the host's sandboxed iframe. Uses the official MCP Apps client
 * (`App`) to receive the tool result from the host. The card is read-only —
 * it renders backup-appliance status and exposes no write actions.
 *
 * The server attaches a normalized `_card` payload to unitrends_get_appliance
 * results (see src/appliance-card.ts) so this renderer never needs to
 * interpret raw appliance objects itself.
 *
 * Rendering uses DOM construction (no innerHTML) — appliance names and
 * hostnames are untrusted vendor data, so text only ever lands in text nodes.
 *
 * White-label: the card is neutral by default and applies an injected
 * `window.__BRAND__` override (set by the MCP server via MCP_BRAND_* env
 * vars or, eventually, the gateway per-org) so the same card can render in
 * any customer's brand. No injection = neutral card with no brand identity.
 */
import { App } from "@modelcontextprotocol/ext-apps";

interface Brand {
  name?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  bg?: string;
  text?: string;
}
declare global {
  interface Window {
    __BRAND__?: Brand;
  }
}

/** Mirror of ApplianceCard in src/appliance-card.ts — keep in sync. */
interface ApplianceCard {
  applianceId: string;
  name: string;
  hostname?: string;
  model?: string;
  version?: string;
  status?: string;
}

const brand: Brand = window.__BRAND__ ?? {};

// Apply any injected brand overrides onto the CSS custom properties.
function applyBrand(): void {
  const root = document.documentElement.style;
  if (brand.primaryColor) root.setProperty("--brand-primary", brand.primaryColor);
  if (brand.accentColor) root.setProperty("--brand-accent", brand.accentColor);
  if (brand.bg) root.setProperty("--brand-bg", brand.bg);
  if (brand.text) root.setProperty("--brand-text", brand.text);
}

const app = new App({ name: "Unitrends Appliance Card", version: "1.0.0" });

/** Create an element with a class and (safe, text-node) children. */
function el(
  tag: string,
  className = "",
  ...children: Array<Node | string | null>
): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) {
    if (child == null) continue;
    node.append(child); // strings become text nodes — never parsed as HTML
  }
  return node;
}

function field(label: string, value: string | undefined): HTMLElement | null {
  if (!value) return null;
  return el(
    "div",
    "field",
    el("div", "field__label", label),
    el("div", "field__value", value),
  );
}

function badge(text: string | undefined, cls: string): HTMLElement | null {
  return text ? el("span", `badge ${cls}`, text) : null;
}

function render(a: ApplianceCard): void {
  // Brand identity only renders when a brand was injected — the neutral
  // default card carries no identity at all.
  const brandId = el("span", "brandid");
  if (brand.logoUrl) {
    const logo = document.createElement("img");
    logo.src = brand.logoUrl;
    logo.alt = brand.name ?? "";
    logo.style.display = "inline-block";
    brandId.append(logo);
  }
  if (brand.name) brandId.append(el("span", "brand", brand.name));

  const body = el(
    "div",
    "card__body",
    el("div", "brandrow", brandId, el("span", "applianceid", `${a.applianceId} · Unitrends`)),
    el("h1", "", a.name),
    el("div", "badges", badge(a.status, "badge--status"), badge(a.model, "badge--model")),
    el(
      "div",
      "grid",
      field("Hostname", a.hostname),
      field("Version", a.version),
      field("Appliance ID", a.applianceId),
    ),
  );

  const root = document.getElementById("root")!;
  root.replaceChildren(el("div", "card", el("div", "card__bar"), body));
}

// unitrends-mcp returns the appliance JSON directly, with the normalized card
// attached as a top-level _card field.
function extractCard(obj: unknown): ApplianceCard | null {
  const card = (obj as { _card?: ApplianceCard })?._card;
  return card && typeof card.applianceId === "string" && card.name ? card : null;
}

applyBrand();

// Must be set before connect() so the initial tool-result isn't missed.
app.ontoolresult = (result: { content?: Array<{ type: string; text?: string }> }) => {
  const payload = (result.content ?? []).find((c) => c.type === "text");
  if (!payload?.text) return;
  try {
    const card = extractCard(JSON.parse(payload.text));
    if (card) render(card);
  } catch {
    /* ignore malformed payloads */
  }
};

app.connect();
