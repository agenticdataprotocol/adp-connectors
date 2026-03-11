"""CLI entry point for the ADP-MCP bridge server."""

import argparse
import logging
from pathlib import Path

from adp_mcp.server import create_server

logger = logging.getLogger(__name__)

_DEFAULT_LOG_FILENAME = "adp-mcp.log"


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
    parser.add_argument(
        "--log-file",
        default=None,
        help=(
            "Path to log file. Defaults to '<config-dir>/adp-mcp.log'. "
            "Set to 'stderr' to write logs to stderr instead."
        ),
    )
    args = parser.parse_args()

    log_dir: str | None = None
    if args.log_file == "stderr":
        handler: logging.Handler = logging.StreamHandler()
        # log_dir stays None; Hypervisor uses its own default log location.
    else:
        log_path = (
            Path(args.log_file) if args.log_file else Path(args.config) / _DEFAULT_LOG_FILENAME
        )
        log_path.parent.mkdir(parents=True, exist_ok=True)
        handler = logging.FileHandler(log_path)
        log_dir = str(log_path.parent)

    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
        handlers=[handler],
    )

    server = create_server(args.config, log_dir=log_dir)
    server.run(transport="stdio")


if __name__ == "__main__":
    main()
