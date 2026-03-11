"""MCP Server module exposing ADP Hypervisor resources as MCP tools.

Uses FastMCP to register four tools (discover, describe, validate, execute)
that bridge MCP tool calls to the ADP Hypervisor via adp-sdk ClientSession
over a subprocess stdio transport.
"""

import json
import logging
import os
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any, cast

from adp_sdk import ClientSession, IntentClass, basic_auth, stdio_client
from adp_sdk.shared import ADPError
from adp_sdk.types.intents import Intent
from adp_sdk.types.requests import DiscoverFilter
from mcp.server.fastmcp import Context, FastMCP
from mcp.shared.exceptions import McpError
from mcp.types import INTERNAL_ERROR, ErrorData
from pydantic import Field, TypeAdapter, ValidationError

logger = logging.getLogger(__name__)

_INTENT_ADAPTER: TypeAdapter[Intent] = TypeAdapter(Intent)

_ENV_VAR_USERNAME = "ADP_USERNAME"
_ENV_VAR_PASSWORD = "ADP_PASSWORD"

_VALID_INTENT_CLASSES: frozenset[str] = frozenset({"LOOKUP", "QUERY", "INGEST", "REVISE", "*"})


def _build_authorization() -> str | None:
    """Build a Basic Auth header from environment variables.

    Reads ADP_USERNAME and ADP_PASSWORD from the environment.
    Returns None if ADP_USERNAME is not set (anonymous access).
    """
    username = os.environ.get(_ENV_VAR_USERNAME)
    if not username:
        return None
    password = os.environ.get(_ENV_VAR_PASSWORD, "")
    return str(basic_auth(username, password))


def create_server(config_path: str, log_dir: str | None = None) -> FastMCP:
    """Create and configure the MCP server with ADP bridge tools.

    Args:
        config_path: Path to the ADP manifest directory.
        log_dir: Directory for log files. When set, the Hypervisor subprocess
            writes its log to ``<log_dir>/hypervisor.log``. Otherwise the
            Hypervisor uses its own default (``<config-dir>/hypervisor.log``).

    Returns:
        A configured FastMCP instance ready to run.
    """
    authorization = _build_authorization()

    hypervisor_args = ["-m", "adp_hypervisor", "--config", config_path]
    if log_dir:
        hypervisor_log = str(Path(log_dir) / "hypervisor.log")
        hypervisor_args += ["--log-file", hypervisor_log]

    @asynccontextmanager
    async def app_lifespan(server: FastMCP) -> AsyncIterator[dict[str, ClientSession]]:
        """Manage ClientSession lifecycle tied to MCP server startup/shutdown.

        Args:
            server: The FastMCP server instance.

        Yields:
            A dict containing the initialized ClientSession.
        """
        async with stdio_client(
            sys.executable,
            args=hypervisor_args,
            authorization=authorization,
        ) as session:
            yield {"session": session}

    mcp = FastMCP("adp-mcp-bridge", lifespan=app_lifespan)

    @mcp.tool()
    async def adp_discover(
        domain_prefix: Annotated[
            str | None, Field(description="Filter by domain prefix, e.g. 'com.acme'.")
        ] = None,
        intent_class: Annotated[
            str | None,
            Field(description="Filter by intent class: LOOKUP, QUERY, INGEST, or REVISE."),
        ] = None,
        keyword: Annotated[
            str | None, Field(description="Keyword search across resource names and descriptions.")
        ] = None,
        cursor: Annotated[
            str | None, Field(description="Pagination cursor from a previous discover response.")
        ] = None,
        ctx: Context[Any, Any, Any] | None = None,
    ) -> str:
        """List available ADP resources.

        Use filters to narrow by domain, intent class, or keyword. Returns a JSON object
        with a 'resources' array (resourceId, supportedIntentClasses, description).
        Call this first to find a resourceId before using adp_describe or adp_execute.
        """
        if ctx is None:
            raise McpError(ErrorData(code=INTERNAL_ERROR, message="MCP context is unavailable"))
        session: ClientSession = ctx.request_context.lifespan_context["session"]
        # Normalize empty strings to None so agents passing "" are treated as "no filter".
        domain_prefix = domain_prefix or None
        keyword = keyword or None
        cursor = cursor or None
        filter_obj: DiscoverFilter | None = None
        if any(p is not None for p in (domain_prefix, intent_class, keyword)):
            if intent_class is not None and intent_class not in _VALID_INTENT_CLASSES:
                raise McpError(
                    ErrorData(
                        code=INTERNAL_ERROR,
                        message=f"Unknown intent class: {intent_class!r}",
                    )
                )
            filter_obj = DiscoverFilter(
                domainPrefix=domain_prefix,
                intentClass=cast(IntentClass, intent_class) if intent_class else None,
                keyword=keyword,
            )
        logger.debug(
            "adp_discover called: domain_prefix=%r, intent_class=%r, keyword=%r, cursor=%r",
            domain_prefix,
            intent_class,
            keyword,
            cursor,
        )
        try:
            result = await session.discover(filter=filter_obj, cursor=cursor)
        except ADPError as e:
            logger.error("adp_discover failed: %s", e, exc_info=True)
            raise McpError(ErrorData(code=INTERNAL_ERROR, message=str(e))) from e
        payload = json.dumps(result.model_dump(by_alias=True, exclude_none=True), indent=2)
        logger.debug("adp_discover returned %d resources", len(result.resources))
        return payload

    @mcp.tool()
    async def adp_describe(
        resource_id: Annotated[
            str,
            Field(
                description="Resource identifier in 'domain:alias' format, e.g. 'com.acme:users'."
            ),
        ],
        intent_class: Annotated[
            str, Field(description="Intent class to describe: LOOKUP, QUERY, INGEST, or REVISE.")
        ],
        version: Annotated[
            int | None,
            Field(description="Resource schema version to describe. Defaults to latest."),
        ] = None,
        cursor: Annotated[
            str | None, Field(description="Pagination cursor for large field lists.")
        ] = None,
        ctx: Context[Any, Any, Any] | None = None,
    ) -> str:
        """Get the usage contract for an ADP resource and intent class.

        Returns field schema, available predicates, projection options, and mutable fields.
        Always call this before adp_validate or adp_execute to understand the intent IR shape.
        """
        if ctx is None:
            raise McpError(ErrorData(code=INTERNAL_ERROR, message="MCP context is unavailable"))
        session: ClientSession = ctx.request_context.lifespan_context["session"]
        cursor = cursor or None
        if intent_class not in _VALID_INTENT_CLASSES:
            raise McpError(
                ErrorData(code=INTERNAL_ERROR, message=f"Unknown intent class: {intent_class!r}")
            )
        intent_class_typed = cast(IntentClass, intent_class)
        logger.debug(
            "adp_describe called: resource_id=%r, intent_class=%r, version=%r, cursor=%r",
            resource_id,
            intent_class,
            version,
            cursor,
        )
        try:
            result = await session.describe(
                resource_id=resource_id,
                intent_class=intent_class_typed,
                version=version,
                cursor=cursor,
            )
        except ADPError as e:
            logger.error("adp_describe failed: %s", e, exc_info=True)
            raise McpError(ErrorData(code=INTERNAL_ERROR, message=str(e))) from e
        payload = json.dumps(result.model_dump(by_alias=True, exclude_none=True), indent=2)
        logger.debug("adp_describe returned for %s/%s", resource_id, intent_class)
        return payload

    @mcp.tool()
    async def adp_validate(
        intent: Annotated[
            dict[str, object],
            Field(
                description=(
                    "Full intent IR object. Must include 'intentClass' "
                    "(LOOKUP/QUERY/INGEST/REVISE) and 'resourceId'. "
                    "Build from the usage contract returned by adp_describe."
                )
            ),
        ],
        ctx: Context[Any, Any, Any] | None = None,
    ) -> str:
        """Validate an intent IR against a resource's schema without executing it.

        Returns {valid: bool, issues: [...]} – check before adp_execute to catch errors early.
        """
        if ctx is None:
            raise McpError(ErrorData(code=INTERNAL_ERROR, message="MCP context is unavailable"))
        session: ClientSession = ctx.request_context.lifespan_context["session"]
        logger.debug("adp_validate called: intent=%r", intent)
        try:
            intent_obj = _INTENT_ADAPTER.validate_python(intent)
            result = await session.validate(intent=intent_obj)
        except ValidationError as e:
            logger.error("adp_validate failed (validation): %s", e, exc_info=True)
            raise McpError(ErrorData(code=INTERNAL_ERROR, message=str(e))) from e
        except ADPError as e:
            logger.error("adp_validate failed: %s", e, exc_info=True)
            raise McpError(ErrorData(code=INTERNAL_ERROR, message=str(e))) from e
        payload = json.dumps(result.model_dump(by_alias=True, exclude_none=True), indent=2)
        logger.debug("adp_validate returned: valid=%s", result.valid)
        return payload

    @mcp.tool()
    async def adp_execute(
        intent: Annotated[
            dict[str, object],
            Field(
                description=(
                    "Full intent IR object. Must include 'intentClass' "
                    "(LOOKUP/QUERY/INGEST/REVISE) and 'resourceId'. "
                    "Build from the usage contract returned by adp_describe."
                )
            ),
        ],
        cursor: Annotated[
            str | None, Field(description="Pagination cursor from a previous execute response.")
        ] = None,
        ctx: Context[Any, Any, Any] | None = None,
    ) -> str:
        """Execute an ADP intent against a resource and return results.

        Use adp_describe to learn the schema, adp_validate to check the intent, then call this.
        Returns {results: [...], nextCursor?} – pass nextCursor as cursor to page through results.
        """
        if ctx is None:
            raise McpError(ErrorData(code=INTERNAL_ERROR, message="MCP context is unavailable"))
        session: ClientSession = ctx.request_context.lifespan_context["session"]
        cursor = cursor or None
        logger.debug("adp_execute called: intent=%r, cursor=%r", intent, cursor)
        try:
            intent_obj = _INTENT_ADAPTER.validate_python(intent)
            result = await session.execute(intent=intent_obj, cursor=cursor)
        except ValidationError as e:
            logger.error("adp_execute failed (validation): %s", e, exc_info=True)
            raise McpError(ErrorData(code=INTERNAL_ERROR, message=str(e))) from e
        except ADPError as e:
            logger.error("adp_execute failed: %s", e, exc_info=True)
            raise McpError(ErrorData(code=INTERNAL_ERROR, message=str(e))) from e
        payload = json.dumps(result.model_dump(by_alias=True, exclude_none=True), indent=2)
        logger.debug("adp_execute returned %d results", len(result.results))
        return payload

    return mcp
