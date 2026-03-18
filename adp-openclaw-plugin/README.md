# adp-openclaw-plugin

An [OpenClaw](https://github.com/openclaw/openclaw) plugin that bridges
[ADP Hypervisor](https://github.com/agenticdataprotocol/adp-hypervisor)
operations as native OpenClaw agent tools.

## Tools

| Tool | Description |
|------|-------------|
| `adp_discover` | List available ADP resources, with optional filters by domain, intent class, or keyword |
| `adp_describe` | Get the usage contract (field schema, predicates, projections) for a resource + intent class |
| `adp_validate` | Validate an intent against a resource schema without executing it |
| `adp_execute` | Execute an ADP intent and return results (supports pagination via cursor) |

## Docker Quickstart

The fastest way to try the plugin is via the self-contained Docker Compose
stack — no local Node.js or Python installation required:

```bash
cd docker
docker compose up -d
```

This starts an OpenClaw gateway (port 18789) with the plugin pre-installed,
plus PostgreSQL, pgvector, and MongoDB backends seeded with demo data.
See [`docker/README.md`](docker/README.md) for full details.

## Prerequisites

- Node.js 22+
- Python 3.11+ with the `adp-hypervisor` package installed (`pip install --pre adp-hypervisor`)
- OpenClaw gateway running

## Installation

```bash
# From local path (recommended for development)
openclaw plugins install /path/to/adp-openclaw-plugin --link

# Or copy to extensions directory
cp -r adp-openclaw-plugin ~/.openclaw/extensions/adp-openclaw-plugin
cd ~/.openclaw/extensions/adp-openclaw-plugin && npm install
```

## Configuration

Configure the plugin in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "adp-openclaw-plugin": {
        "enabled": true,
        "config": {
          "transport": "stdio",
          "command": ["python", "-m", "adp_hypervisor", "--config", "/path/to/config"],
          "username": "admin",
          "password": ""
        }
      }
    }
  }
}
```

Or via CLI:

```bash
openclaw config set plugins.entries.adp-openclaw-plugin.config.username admin
openclaw plugins enable adp-openclaw-plugin
```

### Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `transport` | Yes | — | Transport protocol (currently only `stdio`) |
| `command` | Yes | — | Command to spawn the ADP Hypervisor (string array) |
| `username` | Yes | — | ADP username for RBAC authorization |
| `password` | Yes | — | ADP password (use `""` if not required) |
| `env` | No | — | Additional environment variables for the subprocess |

### Command Examples

**Local Python:**
```json
"command": ["python", "-m", "adp_hypervisor", "--config", "/path/to/config"]
```

**Python virtualenv:**
```json
"command": ["/home/user/venv/bin/python", "-m", "adp_hypervisor", "--config", "/path/to/config"]
```

**Docker Compose:**
```json
"command": ["docker", "compose", "-f", "/path/to/compose.yaml", "exec", "-iT", "runtime", "python", "-m", "adp_hypervisor", "--config", "/opt/adp/config"]
```

**With log level:**
```json
"command": ["python", "-m", "adp_hypervisor", "--config", "/path/to/config", "--log-level", "DEBUG"]
```

## Troubleshooting

**Hypervisor exits immediately after spawn**

1. Verify `adp-hypervisor` is installed: `python -m adp_hypervisor --help`
2. If using a virtualenv, use the absolute Python path in the `command` array
3. Ensure the config path passed in `command` points to a directory containing `physical.yaml`, `semantic.yaml`, and `policy.yaml` (copy from the `.yaml.template` files in `config/`)

**Plugin not found**

Ensure `openclaw plugins install --link` was run, or the plugin is under `~/.openclaw/extensions/`.

**Checking logs**

The plugin pipes Hypervisor stderr to the gateway log. Check with:

```bash
# Gateway logs
tail -f /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log

# Hypervisor's own log file (if logging_conf.yaml.template was copied to logging_conf.yaml)
tail -f /path/to/logs/hypervisor.log
```

## Development

```bash
cd adp-openclaw-plugin
npm install
npx vitest run          # unit tests
npx tsc --noEmit        # type check
```

## License

[Apache License 2.0](../LICENSE)
