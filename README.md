# adp-connectors

A monorepo for ADP (Agentic Data Protocol) connector sub-projects.

## Sub-projects

| Directory | Package | Description |
|-----------|---------|-------------|
| [`adp-mcp/`](./adp-mcp/) | `adp-mcp` | MCP server bridging LLM agents to ADP Hypervisor |
| [`adp-skills/`](./adp-skills/) | — | Agent skills for ADP integration |
| [`adp-openclaw-plugin/`](./adp-openclaw-plugin/) | `adp-openclaw-plugin` | OpenClaw plugin that bridges ADP Hypervisor operations as native OpenClaw tools |

## Docker Quickstart

The `adp-mcp` sub-project ships a self-contained Docker Compose stack for local experimentation.
See [adp-mcp/docker/README.md](./adp-mcp/docker/README.md) for setup instructions.
