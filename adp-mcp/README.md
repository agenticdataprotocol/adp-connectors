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
adp-mcp --config /path/to/adp/manifest [--log-level INFO] [--log-file /path/to/log]
```

Set `--log-file stderr` to write logs to stderr instead of a file.

### Authentication

Set environment variables for Basic Auth:

```bash
export ADP_USERNAME=myuser
export ADP_PASSWORD=mypassword
```

If `ADP_USERNAME` is not set, the server connects anonymously.

### MCP Client Configuration

```json
{
  "mcpServers": {
    "adp": {
      "command": "adp-mcp",
      "args": ["--config", "/path/to/adp/manifest"]
    }
  }
}
```

## Development

```bash
cd adp-mcp
uv sync --extra dev
uv run python -m unittest discover -s tests -v
```
