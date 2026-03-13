# ADP MCP — Docker Compose Quickstart

A self-contained Docker Compose stack that launches all backend dependencies
(PostgreSQL, pgvector, MongoDB, local filesystem) and a ready-to-use
`mcp-runtime` container. Connect any MCP client and start exploring
ADP resources in minutes.

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Docker Engine | 24 + |
| Docker Compose v2 | included with Docker Desktop |

Verify your installation:

```bash
docker compose version   # Docker Compose version v2.x.x
```

## Quick Start

### 1. Start the stack

```bash
cd adp-mcp/docker
docker compose up -d
```

> The first run builds the `mcp-runtime` image and pulls database images.
> This typically takes about one minute.

### 2. Configure your MCP client

Point your MCP client at the running container — see
[MCP Client Configuration](#mcp-client-configuration) below.

### 3. Try it out

With the stack running and your MCP client connected, follow the
[Customer Churn Investigation](examples/customer-churn-investigation.md) scenario
for a step-by-step walkthrough across all four backends.

### 4. Stop the stack

```bash
docker compose down
```

## MCP Client Configuration

The stack does **not** expose a network port for MCP. Instead, your MCP client
runs `adp-mcp` _inside_ the already-running `mcp-runtime` container via
`docker compose exec`. This means the stack must be running **before** the
client connects.

### Claude Desktop

Add the following to your Claude Desktop MCP configuration
(`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "adp": {
      "command": "docker",
      "args": [
        "compose",
        "-f", "/absolute/path/to/adp-mcp/docker/compose.yaml",
        "exec", "-iT",
        "mcp-runtime",
        "adp-mcp", "--config", "/opt/adp/config"
      ]
    }
  }
}
```

> **Replace** `/absolute/path/to/adp-mcp/docker/compose.yaml` with the actual
> path on your machine. You can obtain it by running:
>
> ```bash
> cd adp-mcp/docker && pwd
> ```

> **Important:** The `-iT` flags are both required. `-i` keeps stdin open for
> the stdio transport; `-T` disables pseudo-TTY allocation, which is necessary
> when the MCP client launches the command as a subprocess (stdin is a pipe,
> not a terminal).

### VS Code

Add the following to your workspace `.vscode/mcp.json` (or user-level
`settings.json` under `"mcp.servers"`):

```json
{
  "servers": {
    "adp": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "compose",
        "-f", "/absolute/path/to/adp-mcp/docker/compose.yaml",
        "exec", "-iT",
        "mcp-runtime",
        "adp-mcp", "--config", "/opt/adp/config"
      ]
    }
  }
}
```

> **Replace** `/absolute/path/to/adp-mcp/docker/compose.yaml` with the actual
> path on your machine (same as the Claude Desktop config above).

### Codex CLI

Add the following to `~/.codex/config.toml`:

```toml
[mcp_servers.adp]
transport = { command = "docker", args = [
  "compose",
  "-f", "/absolute/path/to/adp-mcp/docker/compose.yaml",
  "exec", "-iT",
  "mcp-runtime",
  "adp-mcp", "--config", "/opt/adp/config"
] }
enabled = true
```

> **Replace** `/absolute/path/to/adp-mcp/docker/compose.yaml` with the actual
> path on your machine. You can obtain it by running:
>
> ```bash
> cd adp-mcp/docker && pwd
> ```

## Demo Resources

The stack is seeded with the following resources:

| Resource | Backend | Intent Classes | Description |
|----------|---------|----------------|-------------|
| `demo:customers` | PostgreSQL | LOOKUP, QUERY | Customer profiles (5 rows) |
| `demo:products` | PostgreSQL | LOOKUP, QUERY | Product catalog (6 rows, in-stock filter applied) |
| `demo:orders` | PostgreSQL | LOOKUP, QUERY | Customer orders (10 rows) |
| `demo:items` | pgvector | LOOKUP, QUERY | Product embeddings for similarity search (10 rows, 3-D cosine) |
| `demo:customer_profiles` | MongoDB | LOOKUP, QUERY | Customer CRM profiles (5 documents, churn risk / lifetime value) |
| `demo:invoices` | Local filesystem | LOOKUP, QUERY, INGEST, REVISE | Invoice files organised by fulfilment status (6 files) |
| `demo:notes` | Local filesystem | LOOKUP, QUERY, INGEST, REVISE | Analyst notes — default role can read and write |
| `demo:reports` | Local filesystem | LOOKUP, QUERY, INGEST, REVISE | Business reports — write access restricted to admin role |

## Demo Users

The `mcp-runtime` container ships with `ADP_USERNAME=demo` / `ADP_PASSWORD=demo`
pre-configured. This user has the default role and access to all resources.

Additional named users defined in `config/users.yaml`:

| Username | Role | Notes |
|----------|------|-------|
| `admin` | admin | Full administrative access |
| `alice` | analyst | Analyst role |
| `bob` | viewer | Read-only viewer role |

To switch users, override the environment variables when starting the stack:

```bash
ADP_USERNAME=alice ADP_PASSWORD=demo docker compose up -d
```

## Troubleshooting

### Container exited immediately

```bash
docker compose logs mcp-runtime
```

Check the output for missing dependencies or configuration errors.

### MCP client can't connect

1. Make sure the stack is running:

   ```bash
   docker compose ps
   ```

2. Confirm your MCP client config uses `-iT`. The `-i` flag keeps stdin open
   and `-T` disables pseudo-TTY allocation — both are required when the MCP
   client spawns the command as a subprocess. Using `-i` alone causes
   `docker compose exec` to exit with "the input device is not a TTY".

### Backend connection refused

The `mcp-runtime` container waits for backends to become healthy before
starting, but if you connect very quickly the databases may still be
initializing. Check health status:

```bash
docker compose ps
```

All services should show `healthy` in the STATUS column.

### Port conflicts (5432, 5433, 27017 already in use)

The stack maps backend ports to the host for debugging convenience:

| Service | Host port |
|---------|-----------|
| PostgreSQL | 5432 |
| pgvector | 5433 |
| MongoDB | 27017 |

If a port is already in use, either stop the local database occupying the port
or change the mapping in `compose.yaml`.

### Image build fails

The Dockerfile installs `adp-mcp` from PyPI. Ensure the package is published
and accessible:

```bash
pip install adp-mcp --dry-run
```

### Upgrading `adp-mcp` to a newer version

When a new version of `adp-mcp` is released, rebuild the `mcp-runtime` image:

```bash
docker compose build --no-cache mcp-runtime
docker compose up -d
```

To avoid a rebuild on every `docker compose up` (useful when restarting the
stack frequently), build the image once under an explicit tag and switch
`compose.yaml` to reference it by name:

```bash
# build once
docker build -t adp-mcp-runtime:latest .

# then in compose.yaml, replace:
#   build:
#     context: .
# with:
#   image: adp-mcp-runtime:latest
```

The named image is reused on every subsequent `docker compose up` without
triggering a rebuild.

### Viewing hypervisor logs

The ADP Hypervisor writes structured logs to `./logs/hypervisor.log` on the
host (mounted into the container at `/opt/adp/logs/`). Logs rotate
automatically at 10 MB with up to 5 backups.

```bash
tail -f logs/hypervisor.log
```

To increase verbosity, edit `config/logging_conf.yaml` and change the root
`level` to `DEBUG`, then restart the stack.

## Limitations

- **Local demo only** — this stack is designed for experimentation and is not a
  production deployment pattern.
- **stdio transport** — `adp-mcp` communicates via stdin/stdout and does not
  expose a network port.
- **Hardcoded credentials** — demo database and ADP credentials are embedded in
  `compose.yaml`. Do not use them in production.
