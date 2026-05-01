# Unitrends Backup MCP Server

[![CI](https://github.com/wyre-technology/unitrends-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/wyre-technology/unitrends-mcp/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

A [Model Context Protocol](https://modelcontextprotocol.io) server exposing the
[Unitrends Backup](https://www.unitrends.com/) API to Claude and other MCP clients.

## What it does

Surface backup posture from your Unitrends appliances (or MSP Console) directly
to AI assistants — list appliances and protected assets, monitor running and
historical backup jobs, browse recovery points, queue restores and replication,
and review open alarms and RPO compliance.

## Tools

| Tool | Purpose |
| --- | --- |
| `unitrends_list_appliances` | List appliances under the MSP Console |
| `unitrends_list_assets` | List protected assets (require applianceId — elicits if missing) |
| `unitrends_get_asset` | Fetch a single asset detail |
| `unitrends_list_running_jobs` | Currently running and queued backup jobs |
| `unitrends_list_job_history` | Historical jobs (date-range elicitation) |
| `unitrends_list_recovery_points` | Recovery points for an asset |
| `unitrends_queue_restore` | Queue a restore (DESTRUCTIVE — requires confirmation) |
| `unitrends_get_restore_status` | Check restore progress |
| `unitrends_list_alerts` | Open alarms |
| `unitrends_get_success_rate` | RPO compliance report (date-range elicitation) |

## Credentials

### Local (env mode)

```sh
export UNITRENDS_BASE_URL="https://unitrends.example.com"
export UNITRENDS_USERNAME="..."
export UNITRENDS_PASSWORD="..."
export UNITRENDS_VERIFY_TLS="true"   # 'false' for self-signed appliances
```

### Hosted (gateway mode)

The WYRE MCP Gateway injects credentials per request via headers:

- `X-Unitrends-Base-URL` (required)
- `X-Unitrends-Username` (required)
- `X-Unitrends-Password` (required, secret)
- `X-Unitrends-Verify-TLS` (optional, default `true`)

## Run

```sh
npm install
npm run build
npm start                       # stdio
MCP_TRANSPORT=http npm start    # HTTP on :8080
```

## License

Apache 2.0 — see [LICENSE](LICENSE).
