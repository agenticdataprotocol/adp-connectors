# adp-mcp

ADP MCP Bridge — an [MCP](https://modelcontextprotocol.io/) server that exposes
[ADP Hypervisor](https://github.com/adp-org/adp-hypervisor) resources as MCP tools,
enabling LLM agents to discover, describe, validate, and execute ADP intents.

## Tools

| Tool | Description |
|------|-------------|
| `adp_discover` | List available ADP resources, with optional filters by domain, intent class, or keyword |
| `adp_describe` | Get the usage contract (field schema, predicates, projections) for a resource + intent class |
| `adp_validate` | Validate an intent IR against a resource schema without executing it |
| `adp_execute` | Execute an ADP intent and return results (supports pagination via cursor) |

## Installation

```bash
pip install adp-mcp
```

## Usage

```bash
adp-mcp --config /path/to/adp/config [--log-level INFO]
```

Logs are written to stderr. To redirect them to a file, use shell redirection:

```bash
adp-mcp --config /path/to/adp/config 2>/path/to/adp-mcp.log
```

### Authentication

Set environment variables for Basic Auth:

```bash
export ADP_USERNAME=myuser
export ADP_PASSWORD=mypassword
```

If `ADP_USERNAME` is not set, the server connects anonymously.

### MCP Client Configuration

#### Claude Desktop

Add the following to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "adp": {
      "command": "adp-mcp",
      "args": ["--config", "/path/to/adp/config"]
    }
  }
}
```

#### VS Code

Add the following to your workspace `.vscode/mcp.json` (or user-level
`settings.json` under `"mcp.servers"`):

```json
{
  "servers": {
    "adp": {
      "type": "stdio",
      "command": "adp-mcp",
      "args": ["--config", "/path/to/adp/config"]
    }
  }
}
```

#### Codex CLI

Add the following to `~/.codex/config.toml`:

```toml
[mcp_servers.adp]
transport = { command = "adp-mcp", args = ["--config", "/path/to/adp/config"] }
enabled = true
```

## Docker Quickstart

The [`docker/`](./docker/) directory contains a self-contained Docker Compose stack
that starts all backend dependencies and a prepared `mcp-runtime` container.
This is the fastest way to try ADP MCP without installing anything locally.

```bash
cd adp-mcp/docker
docker compose up -d
```

See [docker/README.md](./docker/README.md) for the full setup guide and MCP client configuration.

## Development

```bash
cd adp-mcp
uv sync --extra dev
uv run python -m unittest discover -s tests -v
```
