# adp-openclaw-plugin

ADP OpenClaw Plugin — an [OpenClaw](https://github.com/openclaw/openclaw) plugin that exposes
[ADP Hypervisor](https://github.com/adp-org/adp-hypervisor) resources as native OpenClaw agent tools,
enabling agents to discover, describe, validate, and execute ADP intents through a managed subprocess bridge.

## Tools

| Tool | Description |
|------|-------------|
| `adp_discover` | List available ADP resources, with optional filters by domain, intent class, or keyword |
| `adp_describe` | Get the usage contract (field schema, predicates, projections) for a resource + intent class |
| `adp_validate` | Validate an intent against a resource schema without executing it |
| `adp_execute` | Execute an ADP intent and return results (supports pagination via cursor) |

## Architecture

The plugin spawns ADP Hypervisor as a child process and communicates over
JSON-RPC 2.0 on stdio (NDJSON framing):

- **Subprocess lifecycle** — auto-starts the Hypervisor when the OpenClaw gateway
  boots and shuts it down gracefully on stop.
- **JSON-RPC 2.0 / NDJSON** — each request/response is a single newline-delimited
  JSON object on the subprocess's stdin/stdout.
- **Native tools** — operations are registered as first-class OpenClaw tools,
  callable by any agent connected to the gateway.

## Prerequisites

- Node.js 22+
- Python 3.10+ with the `adp-hypervisor` package installed
- OpenClaw gateway running

## Installation

### Option A — CLI install

```bash
# Install from local path
# node /home/liminghuang/adp-demo/openclaw/dist/index.js plugins install /path/to/adp-openclaw-plugin
openclaw plugins install /path/to/adp-openclaw-plugin

# Or if developing, use --link for symlink
# node /home/liminghuang/adp-demo/openclaw/dist/index.js plugins install /home/liminghuang/adp-demo/adp-connectors/adp-openclaw-plugin --link
openclaw plugins install /path/to/adp-openclaw-plugin --link
```

### Option B — Manual

```bash
mkdir -p ~/.openclaw/extensions
cp -r adp-openclaw-plugin ~/.openclaw/extensions/adp-openclaw-plugin
cd ~/.openclaw/extensions/adp-openclaw-plugin
npm install --omit=dev
```

## Configuration

Add the plugin configuration to `~/.openclaw/openclaw.json` under `plugins.entries`:

```json
{
  "plugins": {
    "entries": {
      "adp-openclaw-plugin": {
        "enabled": true,
        "config": {
          "configPath": "/path/to/adp/manifests",
          "username": "release_manager",
          "logLevel": "INFO"
        }
      }
    }
  }
}
```

Or via CLI:

```bash
openclaw plugins enable adp-openclaw-plugin
openclaw config set plugins.entries.adp-openclaw-plugin.config.configPath /path/to/adp/manifests
openclaw config set plugins.entries.adp-openclaw-plugin.config.username release_manager
openclaw config set plugins.entries.adp-openclaw-plugin.config.logLevel INFO
```

### Configuration fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `configPath` | Yes | — | Path to directory containing ADP manifest YAML files |
| `command` | No | `python` | Python executable to use |
| `args` | No | `["-m", "adp_hypervisor"]` | Arguments for the Hypervisor command |
| `username` | No | — | ADP username for RBAC (sets `ADP_USERNAME` env var) |
| `logLevel` | No | — | Hypervisor log level (`DEBUG`, `INFO`, `WARNING`, `ERROR`) |
| `env` | No | — | Additional environment variables for the subprocess |

## Verify Installation

```bash
# Check plugin is discovered
openclaw plugins list

# Check plugin details
openclaw plugins info adp-openclaw-plugin

# Restart gateway and check logs
pm2 restart openclaw-gateway
pm2 logs openclaw-gateway --lines 20
# Should see: adp-bridge: Hypervisor connected (...)
```

## Development

```bash
cd adp-openclaw-plugin
npm install
npx vitest run
```

## License

[Apache License 2.0](./LICENSE)
