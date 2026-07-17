# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Interactive appliance card via MCP Apps (SEP-1865).** A new `unitrends_get_appliance` tool fetches a single appliance by identifier, and its results render as an interactive card in MCP Apps hosts (Claude Desktop/web, and other hosts advertising the `io.modelcontextprotocol/ui` extension) instead of a wall of JSON. The card shows the appliance name, hostname, model, software version, and status. It is read-only — backup infrastructure gets no in-card write actions. Non-App hosts are unaffected: the tool's JSON payload is the raw appliance plus a new `_card` field.
  - `unitrends_get_appliance` advertises the UI via `_meta` (`ui/resourceUri`, plus the nested `ui.resourceUri` form) pointing at a new `ui://unitrends/appliance-card.html` resource served as `text/html;profile=mcp-app`. The server now declares the `resources` capability and answers `resources/list` / `resources/read` for the card.
  - The card is **neutral by default** and brandable via `window.__BRAND__` injection or `MCP_BRAND_*` environment variables (`MCP_BRAND_NAME`, `MCP_BRAND_LOGO_URL`, `MCP_BRAND_PRIMARY_COLOR`, `MCP_BRAND_ACCENT_COLOR`, `MCP_BRAND_BG`, `MCP_BRAND_TEXT`), applied at serve time by replacing the card's `BRAND_INJECT` marker. No branding configured = the HTML is served unchanged and the card renders with no brand identity.
  - The card HTML is a self-contained vite single-file bundle embedded at build time (`src/generated/appliance-card-html.ts`, committed), so it serves identically from stdio and Node HTTP. New `npm run build:ui` regenerates it after editing `ui/` (requires the new `vite`, `vite-plugin-singlefile`, and `@modelcontextprotocol/ext-apps` devDependencies); plain `npm run build` and CI are unaffected.
  - The card payload builder is best-effort: a sparse or unrecognized appliance degrades the card (or drops it) without affecting the tool result. New contract tests in `test/mcp-apps.test.ts` drive the real server over an in-memory transport to pin the `_meta` advertisement, the `ui://` resource wire shape, and the `_card` normalization.
- Initial scaffold of the Unitrends Backup MCP server.
- Stdio + HTTP (StreamableHTTP) transports.
- Gateway-mode credential handling via `X-Unitrends-Base-URL` / `X-Unitrends-Username` / `X-Unitrends-Password` / `X-Unitrends-Verify-TLS` headers.
- 10 tools covering appliances, assets, running and historical jobs, recovery points, restores, replication, alerts, and success-rate reporting.
- Destructive-action confirmation elicitation for `unitrends_queue_restore`.
- Date-range elicitation for job history and success-rate queries.
- Multi-stage `Dockerfile` with GitHub Packages auth via build secret.
- Semantic-release based CI release pipeline (`.github/workflows/release.yml`).
- MCPB packaging script and Smithery registry config.

### Changed
- The MCP server factory moved from `src/index.ts` into `src/mcp-server.ts` (transports stay in `src/index.ts`) so tests can drive the real server. No behavior change.
