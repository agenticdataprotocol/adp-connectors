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
from typing import Annotated, Any, cast

from adp_sdk import ClientSession, IntentClass, basic_auth, stdio_client
from adp_sdk.shared import ADPError
from adp_sdk.types.intents import Intent
from adp_sdk.types.requests import DiscoverFilter
from mcp.server.fastmcp import Context, FastMCP
from mcp.shared.exceptions import McpError
from mcp.types import INTERNAL_ERROR, INVALID_PARAMS, ErrorData
from pydantic import Field, GetCoreSchemaHandler, TypeAdapter, ValidationError
from pydantic.annotated_handlers import GetJsonSchemaHandler
from pydantic.json_schema import JsonSchemaValue
from pydantic_core import core_schema as cs

logger = logging.getLogger(__name__)

_ENV_VAR_USERNAME = "ADP_USERNAME"
_ENV_VAR_PASSWORD = "ADP_PASSWORD"

_VALID_INTENT_CLASSES: frozenset[str] = frozenset({"LOOKUP", "QUERY", "INGEST", "REVISE"})

_intent_adapter: TypeAdapter[Intent] = TypeAdapter(Intent)


class RawIntent:
    """Accept any dict for MCP tool arguments while exposing the full
    Intent discriminated-union JSON schema to tool definitions.

    This lets FastMCP advertise the rich schema to agents while deferring
    strict validation to the tool function body, where errors can be
    formatted in an agent-friendly way.
    """

    def __init__(self, data: dict[str, Any]) -> None:
        self.data = data

    @classmethod
    def __get_pydantic_core_schema__(
        cls, source_type: Any, handler: GetCoreSchemaHandler
    ) -> cs.CoreSchema:
        return cs.no_info_plain_validator_function(cls._validate)

    @classmethod
    def _validate(cls, v: Any) -> "RawIntent":
        if isinstance(v, dict):
            return cls(v)
        raise ValueError("Intent must be a JSON object")

    @classmethod
    def __get_pydantic_json_schema__(
        cls, _core_schema: cs.CoreSchema, handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        return handler(_intent_adapter.core_schema)


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


# ADP error-code constants (from adp_sdk.types.jsonrpc)
_INVALID_PARAMS = -32602
_RESOURCE_NOT_FOUND = -32001
_VALIDATION_FAILED = -32002
_UNAUTHORIZED = -32003
_EXECUTION_FAILED = -32004

_ERROR_HINTS: dict[int, str] = {
    _INVALID_PARAMS: ("Check that your intent structure matches the schema from adp_describe."),
    _RESOURCE_NOT_FOUND: "Use adp_discover to find available resources.",
    _VALIDATION_FAILED: (
        "Review the validation issues in the error data"
        " and apply the suggested correction hints."
    ),
    _EXECUTION_FAILED: ("Try using adp_validate to check your intent before executing."),
    _UNAUTHORIZED: "Verify your credentials and resource access permissions.",
}


def _agent_friendly_message(error: ADPError) -> str:
    """Build an error message with an optional actionable hint for the LLM agent."""
    hint = _ERROR_HINTS.get(error.code)
    if hint:
        return f"{error.message} | Hint: {hint}"
    return error.message


_MAX_SUMMARY_ERRORS = 3


def _format_loc(loc: tuple[str | int, ...]) -> str:
    """Format a Pydantic ``loc`` tuple into a readable dotted path."""
    if not loc:
        return "<root>"
    parts: list[str] = []
    for segment in loc:
        if isinstance(segment, int):
            if parts:
                parts[-1] = f"{parts[-1]}[{segment}]"
            else:
                parts.append(f"[{segment}]")
        else:
            parts.append(str(segment))
    return ".".join(parts)


def _format_validation_error(prefix: str, error: ValidationError) -> str:
    """Format a Pydantic ``ValidationError`` into a concise, agent-friendly message.

    Mirrors the Hypervisor's ``_format_validation_error`` style: shows up to
    ``_MAX_SUMMARY_ERRORS`` individual issues and summarises the rest.
    """
    raw_errors = error.errors(include_url=False, include_input=False, include_context=False)
    if not raw_errors:
        return prefix
    snippets: list[str] = []
    for e in raw_errors[:_MAX_SUMMARY_ERRORS]:
        path = _format_loc(e["loc"])
        snippets.append(f"`{path}`: {e['msg']}" if path != "<root>" else e["msg"])
    summary = f"{prefix}: {'; '.join(snippets)}"
    remaining = len(raw_errors) - _MAX_SUMMARY_ERRORS
    if remaining > 0:
        summary += f"; and {remaining} more"
    return summary + "."


def create_server(config_path: str) -> FastMCP:
    """Create and configure the MCP server with ADP bridge tools.

    Args:
        config_path: Path to the ADP manifest directory.

    Returns:
        A configured FastMCP instance ready to run.
    """
    authorization = _build_authorization()

    hypervisor_args = ["-m", "adp_hypervisor", "--config", config_path]

    @asynccontextmanager
    async def app_lifespan(server: FastMCP) -> AsyncIterator[dict[str, ClientSession]]:
        """Manage ClientSession lifecycle tied to MCP server startup/shutdown.

        Args:
            server: The FastMCP server instance.

        Yields:
            A dict containing the initialized ClientSession.
        """
        # stdio_client is an async context manager: it opens the subprocess transport on
        # enter and closes it (terminating the hypervisor process) on exit, so no explicit
        # close call is needed here.
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
            str | None,
            Field(
                description=(
                    "Case-insensitive keyword filter across resource IDs, "
                    "descriptions, and tags. Plain text performs substring "
                    "matching (e.g. 'user' matches 'user_profiles'). "
                    "Glob wildcards (*, ?, [) are also supported "
                    "(e.g. '*bank*failure*')."
                )
            ),
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
        intent_class = intent_class or None
        keyword = keyword or None
        cursor = cursor or None
        filter_obj: DiscoverFilter | None = None
        if any(p is not None for p in (domain_prefix, intent_class, keyword)):
            if intent_class is not None and intent_class not in _VALID_INTENT_CLASSES:
                raise McpError(
                    ErrorData(
                        code=INVALID_PARAMS,
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
            raise McpError(
                ErrorData(
                    code=e.code,
                    message=_agent_friendly_message(e),
                    data=e.data,
                )
            ) from e
        except Exception as e:
            logger.exception("Unexpected error in adp_discover: %s", e)
            raise McpError(
                ErrorData(
                    code=INTERNAL_ERROR,
                    message=f"Unexpected internal error: {type(e).__name__}: {e}",
                )
            ) from e
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
                ErrorData(code=INVALID_PARAMS, message=f"Unknown intent class: {intent_class!r}")
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
            raise McpError(
                ErrorData(
                    code=e.code,
                    message=_agent_friendly_message(e),
                    data=e.data,
                )
            ) from e
        except Exception as e:
            logger.exception("Unexpected error in adp_describe: %s", e)
            raise McpError(
                ErrorData(
                    code=INTERNAL_ERROR,
                    message=f"Unexpected internal error: {type(e).__name__}: {e}",
                )
            ) from e
        payload = json.dumps(result.model_dump(by_alias=True, exclude_none=True), indent=2)
        logger.debug("adp_describe returned for %s/%s", resource_id, intent_class)
        return payload

    @mcp.tool()
    async def adp_validate(
        intent: Annotated[
            RawIntent,
            Field(
                description=(
                    "The intent IR object to validate. "
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
        try:
            parsed_intent = _intent_adapter.validate_python(intent.data)
        except ValidationError as e:
            raise McpError(
                ErrorData(
                    code=INVALID_PARAMS,
                    message=_format_validation_error("Intent validation failed", e),
                )
            ) from e
        logger.debug("adp_validate called: intent=%r", parsed_intent)
        try:
            result = await session.validate(intent=parsed_intent)
        except ADPError as e:
            logger.error("adp_validate failed: %s", e, exc_info=True)
            raise McpError(
                ErrorData(
                    code=e.code,
                    message=_agent_friendly_message(e),
                    data=e.data,
                )
            ) from e
        except Exception as e:
            logger.exception("Unexpected error in adp_validate: %s", e)
            raise McpError(
                ErrorData(
                    code=INTERNAL_ERROR,
                    message=f"Unexpected internal error: {type(e).__name__}: {e}",
                )
            ) from e
        payload = json.dumps(result.model_dump(by_alias=True, exclude_none=True), indent=2)
        logger.debug("adp_validate returned: valid=%s", result.valid)
        return payload

    @mcp.tool()
    async def adp_execute(
        intent: Annotated[
            RawIntent,
            Field(
                description=(
                    "The intent IR object to execute. "
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
        try:
            parsed_intent = _intent_adapter.validate_python(intent.data)
        except ValidationError as e:
            raise McpError(
                ErrorData(
                    code=INVALID_PARAMS,
                    message=_format_validation_error("Intent validation failed", e),
                )
            ) from e
        logger.debug("adp_execute called: intent=%r, cursor=%r", parsed_intent, cursor)
        try:
            result = await session.execute(intent=parsed_intent, cursor=cursor)
        except ADPError as e:
            logger.error("adp_execute failed: %s", e, exc_info=True)
            raise McpError(
                ErrorData(
                    code=e.code,
                    message=_agent_friendly_message(e),
                    data=e.data,
                )
            ) from e
        except Exception as e:
            logger.exception("Unexpected error in adp_execute: %s", e)
            raise McpError(
                ErrorData(
                    code=INTERNAL_ERROR,
                    message=f"Unexpected internal error: {type(e).__name__}: {e}",
                )
            ) from e
        payload = json.dumps(result.model_dump(by_alias=True, exclude_none=True), indent=2)
        logger.debug("adp_execute returned %d results", len(result.results))
        return payload

    return mcp
