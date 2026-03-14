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
- Python 3.11+ with the `adp-hypervisor` package installed
- OpenClaw gateway running

## Installation

### Option A — CLI install

```bash
# Install from local path
openclaw plugins install /path/to/adp-openclaw-plugin

# Or if developing, use --link for symlink
openclaw plugins install /path/to/adp-openclaw-plugin --link
```

### Option B — Manual

```bash
mkdir -p ~/.openclaw/extensions
cp -r adp-openclaw-plugin ~/.openclaw/extensions/adp-openclaw-plugin
cd ~/.openclaw/extensions/adp-openclaw-plugin
npm install --omit=dev
```

## Deployment (GCP VM Quick Start)

End-to-end steps for deploying the plugin on a GCP VM where OpenClaw gateway is
managed by PM2.

### 1. Install adp-hypervisor Python package

The `adp-hypervisor` package is published on [PyPI](https://pypi.org/project/adp-hypervisor/)
(currently as a dev prerelease). It requires Python 3.11+.

```bash
# Install in existing virtualenv (can share with litellm)
source litellm_env/bin/activate

# Install dev prerelease from PyPI (--pre is required for dev versions)
pip install --pre adp-hypervisor

# Verify
python -m adp_hypervisor --help
```

### 2. Install the plugin

```bash
# Install plugin dependencies
cd /path/to/adp-connectors/adp-openclaw-plugin
npm install

# Set required config BEFORE install (order matters!)
# configPath points to the directory containing ADP manifest YAML files
openclaw config set plugins.entries.adp-openclaw-plugin.config.configPath /path/to/adp-connectors/adp-openclaw-plugin/manifests

# Set Python path to virtualenv (important for PM2-managed processes)
openclaw config set plugins.entries.adp-openclaw-plugin.config.command /path/to/venv/bin/python

# Optional: set username for RBAC
openclaw config set plugins.entries.adp-openclaw-plugin.config.username release_manager

# Link the plugin
openclaw plugins install /path/to/adp-connectors/adp-openclaw-plugin --link
```

#### Data directory setup

The shipped manifests use **relative paths** (`./data` for storage, `./logs/` for
log files). These resolve from the Hypervisor's working directory, which the
plugin sets to the **parent** of `configPath`.

For example, if `configPath` is `/opt/adp/manifests`, create the data and log
directories alongside it:

```bash
mkdir -p /opt/adp/data /opt/adp/logs
```

To use a different location, either override `uri` in `physical.yaml` with an
absolute path or symlink `data` to the desired location.

### 3. Deploy Dora workspace addendum

```bash
# Copy ADP integration instructions to Dora's workspace
cat docs/AGENTS-adp-addendum.md >> ~/.openclaw/workspace-dora/AGENTS.md
```

### 4. Restart and verify

```bash
pm2 restart openclaw-gateway
pm2 logs openclaw-gateway --lines 30
# Should see:
#   adp-bridge: registering (configPath=...)
#   adp-bridge: registered 4 tools (discover, describe, validate, execute)
#   adp-bridge: Hypervisor connected (...)
```

### Important notes

- **Config before install** — Config must be set _before_ `plugins install --link`
  because install validates the plugin's `configSchema` at registration time.
- **PM2 and virtualenvs** — PM2-managed processes don't inherit shell activation,
  so `command` must be set to the absolute path of the virtualenv Python binary
  (e.g., `/home/liminghuang/adp-demo/litellm_env/bin/python`).
- **`npm install` is required** — even though the plugin has zero runtime
  dependencies (TypeBox was removed for CJS/ESM compatibility with OpenClaw's
  jiti loader), `npm install` is still needed to create the `node_modules`
  structure.

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
| `command` | No | `python` | Python executable to use (set to absolute path if using a virtualenv) |
| `args` | No | `["-m", "adp_hypervisor"]` | Arguments for the Hypervisor command |
| `username` | No | — | ADP username for RBAC (sets `ADP_USERNAME` env var) |
| `logLevel` | No | — | Hypervisor log level (`DEBUG`, `INFO`, `WARNING`, `ERROR`) |
| `env` | No | — | Additional environment variables for the subprocess |

> **Note:** When using a Python virtualenv, set `command` to the full path of the
> virtualenv Python binary (e.g., `/home/user/venv/bin/python`) since the gateway
> process does not inherit shell activation.

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

## Troubleshooting

**`Hypervisor subprocess terminated` immediately after spawn**

The Hypervisor subprocess exited right away. Common causes:

1. **`adp-hypervisor` not installed** — verify with `python -m adp_hypervisor --help`
2. **Wrong Python path** — if using a virtualenv, set `command` to the absolute path:
   ```bash
   openclaw config set plugins.entries.adp-openclaw-plugin.config.command /path/to/venv/bin/python
   ```
3. **Invalid manifest path** — ensure `configPath` points to a directory containing
   `physical.yaml`, `semantic.yaml`, and `policy.yaml`

**`plugin not found: adp-openclaw-plugin`**

The plugin was not discovered. Ensure one of:
- `plugins install --link` was run to register the plugin path
- The plugin directory is placed under `~/.openclaw/extensions/`

**`Cannot find module '@sinclair/typebox'`**

Run `npm install` in the plugin directory. If using `--link`, dependencies must be
installed at the source path before the gateway starts.

**`Port 18789 is already in use` after PM2 restart**

PM2's `restart` command sometimes starts the new process before the old one fully
exits, causing a port conflict. Use `delete` + `start` instead:

```bash
pm2 delete openclaw-gateway
pm2 start ecosystem.config.js --only openclaw-gateway
```

**Checking Hypervisor logs**

The plugin pipes Hypervisor stderr to the OpenClaw gateway log. Check logs in these
locations:

```bash
# PM2 logs (combined gateway + plugin output)
pm2 logs openclaw-gateway --lines 50

# OpenClaw gateway log file
tail -f /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log

# Hypervisor's own log file (relative path from manifests parent dir)
tail -f /opt/adp/logs/hypervisor.log
```

> **Tip:** The shipped `logging_conf.yaml` uses a relative `filename`
> (`./logs/hypervisor.log`). If you need an absolute path, edit the file
> directly. See `manifests/logging_conf.yaml` for an example.

## Development

```bash
cd adp-openclaw-plugin
npm install
npx vitest run
```

## License

[Apache License 2.0](./LICENSE)
