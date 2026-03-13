# Copyright 2026 Datastrato, Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

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
