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

```bash
# Copy plugin to OpenClaw extensions directory
cp -r adp-openclaw-plugin ~/.openclaw/extensions/adp-openclaw-plugin
cd ~/.openclaw/extensions/adp-openclaw-plugin
npm install --omit=dev
```

## Configuration

Add the plugin to your OpenClaw config (`~/.openclaw/config.json`):

```json
{
  "extensions": {
    "adp-openclaw-plugin": {
      "configPath": "/path/to/adp/manifests",
      "command": "python",
      "args": ["-m", "adp_hypervisor"],
      "username": "release_manager",
      "logLevel": "INFO"
    }
  }
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `configPath` | Yes | — | Path to directory containing ADP manifest YAML files |
| `command` | No | `python` | Python executable to use |
| `args` | No | `["-m", "adp_hypervisor"]` | Arguments for the Hypervisor command |
| `username` | No | — | ADP username for RBAC (sets `ADP_USERNAME` env var) |
| `logLevel` | No | — | Hypervisor log level (`DEBUG`, `INFO`, `WARNING`, `ERROR`) |
| `env` | No | — | Additional environment variables for the subprocess |

## Development

```bash
cd adp-openclaw-plugin
npm install
npx vitest run
```

## License

[Apache License 2.0](./LICENSE)
