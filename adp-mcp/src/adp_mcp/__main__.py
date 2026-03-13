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

"""CLI entry point for the ADP-MCP bridge server."""

import argparse
import logging

from adp_mcp.server import create_server

logger = logging.getLogger(__name__)


def main() -> None:
    """Parse arguments and start the ADP-MCP bridge server."""
    parser = argparse.ArgumentParser(description="ADP-MCP Bridge Server")
    parser.add_argument(
        "--config",
        required=True,
        help="Path to ADP manifest directory",
    )
    parser.add_argument(
        "--log-level",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        default="INFO",
        help="Logging level (default: INFO)",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
        handlers=[logging.StreamHandler()],
    )

    server = create_server(args.config)
    server.run(transport="stdio")


if __name__ == "__main__":
    main()
