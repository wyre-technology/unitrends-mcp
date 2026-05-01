# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial scaffold of the Unitrends Backup MCP server.
- Stdio + HTTP (StreamableHTTP) transports.
- Gateway-mode credential handling via `X-Unitrends-Base-URL` / `X-Unitrends-Username` / `X-Unitrends-Password` / `X-Unitrends-Verify-TLS` headers.
- 10 tools covering appliances, assets, running and historical jobs, recovery points, restores, replication, alerts, and success-rate reporting.
- Destructive-action confirmation elicitation for `unitrends_queue_restore`.
- Date-range elicitation for job history and success-rate queries.
- Multi-stage `Dockerfile` with GitHub Packages auth via build secret.
- Semantic-release based CI release pipeline (`.github/workflows/release.yml`).
- MCPB packaging script and Smithery registry config.
