"""ADP-MCP Bridge: Expose ADP Hypervisor resources as MCP tools.

This package provides an MCP (Model Context Protocol) server that bridges
LLM agents to the ADP Hypervisor, translating MCP tool calls into ADP
protocol requests via the adp-sdk ClientSession over a subprocess stdio transport.
"""

from adp_mcp.server import create_server

__all__ = [
    # Server factory
    "create_server",
]
