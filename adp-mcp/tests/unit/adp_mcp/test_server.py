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

"""Unit tests for adp_mcp.server."""

import json
import unittest
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

from adp_sdk.shared import (
    ExecutionFailedError,
    InvalidParamsError,
    ParseError,
    ResourceNotFoundError,
    ValidationFailedError,
)
from mcp.shared.memory import create_connected_server_and_client_session

from adp_mcp.server import create_server


def _mock_session(
    discover_result: dict[str, Any] | None = None,
    describe_result: dict[str, Any] | None = None,
    validate_result: dict[str, Any] | None = None,
    execute_result: dict[str, Any] | None = None,
) -> MagicMock:
    """Build a mock ClientSession whose methods return fake Pydantic-like results."""
    session = MagicMock()

    def _make_result(data: dict[str, Any]) -> MagicMock:
        result = MagicMock()
        result.model_dump.return_value = data
        return result

    session.discover = AsyncMock(return_value=_make_result(discover_result or {"resources": []}))
    session.describe = AsyncMock(
        return_value=_make_result(
            describe_result
            or {
                "resourceId": "test:res",
                "intentClass": "QUERY",
                "version": 1,
                "usageContract": {},
            }
        )
    )
    session.validate = AsyncMock(return_value=_make_result(validate_result or {"valid": True}))
    session.execute = AsyncMock(return_value=_make_result(execute_result or {"results": []}))
    return session


def _patch_stdio_client(mock_session: MagicMock) -> Any:
    """Return a patch context manager that replaces stdio_client with one yielding mock_session."""

    @asynccontextmanager
    async def _fake_stdio_client(*args: Any, **kwargs: Any) -> AsyncIterator[MagicMock]:
        yield mock_session

    return patch("adp_mcp.server.stdio_client", side_effect=_fake_stdio_client)


# ===========================================================================


class TestAdpDiscover(unittest.IsolatedAsyncioTestCase):
    """Tests for the adp_discover MCP tool."""

    async def test_discover_no_filters(self) -> None:
        session = _mock_session(discover_result={"resources": [{"resourceId": "a:b"}]})
        server = create_server("/fake/config")

        with _patch_stdio_client(session):
            async with create_connected_server_and_client_session(server) as client:
                result = await client.call_tool("adp_discover", {})

        raw = json.loads(result.content[0].text)
        self.assertEqual(raw["resources"], [{"resourceId": "a:b"}])
        session.discover.assert_called_once_with(filter=None, cursor=None)

    async def test_discover_with_filters(self) -> None:
        session = _mock_session()
        server = create_server("/fake/config")

        with _patch_stdio_client(session):
            async with create_connected_server_and_client_session(server) as client:
                await client.call_tool(
                    "adp_discover",
                    {"domain_prefix": "com.acme", "intent_class": "QUERY", "keyword": "bank"},
                )

        call_kwargs = session.discover.call_args.kwargs
        self.assertIsNotNone(call_kwargs["filter"])
        self.assertEqual(call_kwargs["filter"].domain_prefix, "com.acme")
        self.assertEqual(call_kwargs["filter"].intent_class, "QUERY")
        self.assertEqual(call_kwargs["filter"].keyword, "bank")

    async def test_discover_with_cursor(self) -> None:
        session = _mock_session()
        server = create_server("/fake/config")

        with _patch_stdio_client(session):
            async with create_connected_server_and_client_session(server) as client:
                await client.call_tool("adp_discover", {"cursor": "tok123"})

        session.discover.assert_called_once_with(filter=None, cursor="tok123")

    async def test_discover_adp_error(self) -> None:
        session = _mock_session()
        session.discover.side_effect = ResourceNotFoundError("upstream failure")
        server = create_server("/fake/config")

        with _patch_stdio_client(session):
            async with create_connected_server_and_client_session(server) as client:
                result = await client.call_tool("adp_discover", {})

        self.assertTrue(result.isError)
        self.assertIn("upstream failure", result.content[0].text)
        self.assertIn("Hint:", result.content[0].text)
        self.assertIn("adp_discover", result.content[0].text)


# ===========================================================================


class TestAdpDescribe(unittest.IsolatedAsyncioTestCase):
    """Tests for the adp_describe MCP tool."""

    async def test_describe_basic(self) -> None:
        payload = {
            "resourceId": "com.acme:users",
            "intentClass": "QUERY",
            "version": 2,
            "usageContract": {},
        }
        session = _mock_session(describe_result=payload)
        server = create_server("/fake/config")

        with _patch_stdio_client(session):
            async with create_connected_server_and_client_session(server) as client:
                result = await client.call_tool(
                    "adp_describe",
                    {"resource_id": "com.acme:users", "intent_class": "QUERY"},
                )

        raw = json.loads(result.content[0].text)
        self.assertEqual(raw["resourceId"], "com.acme:users")
        session.describe.assert_called_once_with(
            resource_id="com.acme:users",
            intent_class="QUERY",
            version=None,
            cursor=None,
        )

    async def test_describe_with_version_and_cursor(self) -> None:
        session = _mock_session()
        server = create_server("/fake/config")

        with _patch_stdio_client(session):
            async with create_connected_server_and_client_session(server) as client:
                await client.call_tool(
                    "adp_describe",
                    {
                        "resource_id": "com.acme:users",
                        "intent_class": "LOOKUP",
                        "version": 3,
                        "cursor": "page2",
                    },
                )

        session.describe.assert_called_once_with(
            resource_id="com.acme:users",
            intent_class="LOOKUP",
            version=3,
            cursor="page2",
        )

    async def test_describe_adp_error(self) -> None:
        session = _mock_session()
        session.describe.side_effect = ResourceNotFoundError("describe failed")
        server = create_server("/fake/config")

        with _patch_stdio_client(session):
            async with create_connected_server_and_client_session(server) as client:
                result = await client.call_tool(
                    "adp_describe",
                    {"resource_id": "com.acme:users", "intent_class": "QUERY"},
                )

        self.assertTrue(result.isError)
        self.assertIn("describe failed", result.content[0].text)
        self.assertIn("Hint:", result.content[0].text)
        self.assertIn("adp_discover", result.content[0].text)


# ===========================================================================


class TestAdpValidate(unittest.IsolatedAsyncioTestCase):
    """Tests for the adp_validate MCP tool."""

    async def test_validate_valid_query_intent(self) -> None:
        session = _mock_session(validate_result={"valid": True})
        server = create_server("/fake/config")
        intent = {
            "intentClass": "QUERY",
            "resourceId": "com.acme:users",
            "predicates": {"op": "AND", "predicates": []},
        }

        with _patch_stdio_client(session):
            async with create_connected_server_and_client_session(server) as client:
                result = await client.call_tool("adp_validate", {"intent": intent})

        raw = json.loads(result.content[0].text)
        self.assertTrue(raw["valid"])
        self.assertTrue(session.validate.called)

    async def test_validate_invalid_intent_format(self) -> None:
        session = _mock_session()
        server = create_server("/fake/config")

        with _patch_stdio_client(session):
            async with create_connected_server_and_client_session(server) as client:
                result = await client.call_tool(
                    "adp_validate",
                    {"intent": {"intentClass": "UNKNOWN_CLASS", "resourceId": "x:y"}},
                )

        # Pydantic ValidationError should be caught and returned as MCP error text
        self.assertFalse(session.validate.called)
        self.assertTrue(result.isError)
        self.assertIn("intent validation failed", result.content[0].text.lower())

    async def test_validate_with_issues(self) -> None:
        session = _mock_session(
            validate_result={
                "valid": False,
                "issues": [{"code": "FIELD_UNKNOWN", "message": "bad field"}],
            }
        )
        server = create_server("/fake/config")
        intent = {
            "intentClass": "QUERY",
            "resourceId": "com.acme:users",
            "predicates": {"op": "AND", "predicates": []},
        }

        with _patch_stdio_client(session):
            async with create_connected_server_and_client_session(server) as client:
                result = await client.call_tool("adp_validate", {"intent": intent})

        raw = json.loads(result.content[0].text)
        self.assertFalse(raw["valid"])
        self.assertEqual(len(raw["issues"]), 1)

    async def test_validate_adp_error(self) -> None:
        session = _mock_session()
        session.validate.side_effect = ValidationFailedError(
            "schema mismatch", data={"field": "predicates"}
        )
        server = create_server("/fake/config")
        intent = {
            "intentClass": "QUERY",
            "resourceId": "com.acme:users",
            "predicates": {"op": "AND", "predicates": []},
        }

        with _patch_stdio_client(session):
            async with create_connected_server_and_client_session(server) as client:
                result = await client.call_tool("adp_validate", {"intent": intent})

        self.assertTrue(result.isError)
        self.assertIn("schema mismatch", result.content[0].text)
        self.assertIn("Hint:", result.content[0].text)
        self.assertIn("correction hints", result.content[0].text)


# ===========================================================================


class TestAdpExecute(unittest.IsolatedAsyncioTestCase):
    """Tests for the adp_execute MCP tool."""

    async def test_execute_query_intent(self) -> None:
        rows = [{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}]
        session = _mock_session(execute_result={"results": rows})
        server = create_server("/fake/config")
        intent = {
            "intentClass": "QUERY",
            "resourceId": "com.acme:users",
            "predicates": {"op": "AND", "predicates": []},
        }

        with _patch_stdio_client(session):
            async with create_connected_server_and_client_session(server) as client:
                result = await client.call_tool("adp_execute", {"intent": intent})

        raw = json.loads(result.content[0].text)
        self.assertEqual(raw["results"], rows)
        self.assertTrue(session.execute.called)
        call_kwargs = session.execute.call_args.kwargs
        self.assertIsNone(call_kwargs["cursor"])

    async def test_execute_with_cursor(self) -> None:
        session = _mock_session(execute_result={"results": [], "nextCursor": "next"})
        server = create_server("/fake/config")
        intent = {
            "intentClass": "QUERY",
            "resourceId": "com.acme:users",
            "predicates": {"op": "AND", "predicates": []},
        }

        with _patch_stdio_client(session):
            async with create_connected_server_and_client_session(server) as client:
                await client.call_tool("adp_execute", {"intent": intent, "cursor": "prev_page"})

        call_kwargs = session.execute.call_args.kwargs
        self.assertEqual(call_kwargs["cursor"], "prev_page")

    async def test_execute_invalid_intent_format(self) -> None:
        session = _mock_session()
        server = create_server("/fake/config")

        with _patch_stdio_client(session):
            async with create_connected_server_and_client_session(server) as client:
                result = await client.call_tool(
                    "adp_execute",
                    {"intent": {"intentClass": "BAD", "resourceId": "x:y"}},
                )

        self.assertFalse(session.execute.called)
        self.assertTrue(result.isError)
        self.assertIn("intent validation failed", result.content[0].text.lower())

    async def test_execute_adp_error(self) -> None:
        session = _mock_session()
        session.execute.side_effect = ExecutionFailedError("timeout on upstream")
        server = create_server("/fake/config")
        intent = {
            "intentClass": "QUERY",
            "resourceId": "com.acme:users",
            "predicates": {"op": "AND", "predicates": []},
        }

        with _patch_stdio_client(session):
            async with create_connected_server_and_client_session(server) as client:
                result = await client.call_tool("adp_execute", {"intent": intent})

        self.assertTrue(result.isError)
        self.assertIn("timeout on upstream", result.content[0].text)
        self.assertIn("Hint:", result.content[0].text)
        self.assertIn("adp_validate", result.content[0].text)


# ===========================================================================


class TestUnexpectedExceptionHandling(unittest.IsolatedAsyncioTestCase):
    """Tests for non-ADPError exception catch-all in all tool functions."""

    async def test_discover_unexpected_error(self) -> None:
        session = _mock_session()
        session.discover.side_effect = ConnectionError("connection refused")
        server = create_server("/fake/config")

        with _patch_stdio_client(session):
            async with create_connected_server_and_client_session(server) as client:
                result = await client.call_tool("adp_discover", {})

        self.assertTrue(result.isError)
        self.assertIn("ConnectionError", result.content[0].text)
        self.assertIn("connection refused", result.content[0].text)

    async def test_describe_unexpected_error(self) -> None:
        session = _mock_session()
        session.describe.side_effect = RuntimeError("subprocess crashed")
        server = create_server("/fake/config")

        with _patch_stdio_client(session):
            async with create_connected_server_and_client_session(server) as client:
                result = await client.call_tool(
                    "adp_describe",
                    {"resource_id": "com.acme:users", "intent_class": "QUERY"},
                )

        self.assertTrue(result.isError)
        self.assertIn("RuntimeError", result.content[0].text)
        self.assertIn("subprocess crashed", result.content[0].text)

    async def test_validate_unexpected_error(self) -> None:
        session = _mock_session()
        session.validate.side_effect = TimeoutError("request timed out")
        server = create_server("/fake/config")
        intent = {
            "intentClass": "QUERY",
            "resourceId": "com.acme:users",
            "predicates": {"op": "AND", "predicates": []},
        }

        with _patch_stdio_client(session):
            async with create_connected_server_and_client_session(server) as client:
                result = await client.call_tool("adp_validate", {"intent": intent})

        self.assertTrue(result.isError)
        self.assertIn("TimeoutError", result.content[0].text)
        self.assertIn("request timed out", result.content[0].text)

    async def test_execute_unexpected_error(self) -> None:
        session = _mock_session()
        session.execute.side_effect = OSError("broken pipe")
        server = create_server("/fake/config")
        intent = {
            "intentClass": "QUERY",
            "resourceId": "com.acme:users",
            "predicates": {"op": "AND", "predicates": []},
        }

        with _patch_stdio_client(session):
            async with create_connected_server_and_client_session(server) as client:
                result = await client.call_tool("adp_execute", {"intent": intent})

        self.assertTrue(result.isError)
        self.assertIn("OSError", result.content[0].text)
        self.assertIn("broken pipe", result.content[0].text)


# ===========================================================================


class TestErrorHints(unittest.IsolatedAsyncioTestCase):
    """Tests for _agent_friendly_message hint logic across error codes."""

    async def test_error_hint_included_for_known_codes(self) -> None:
        error_cases = [
            (ResourceNotFoundError("not found"), "adp_discover"),
            (InvalidParamsError("bad params"), "adp_describe"),
            (ExecutionFailedError("exec failed"), "adp_validate"),
        ]
        server = create_server("/fake/config")

        for error, expected_hint_fragment in error_cases:
            with self.subTest(error_type=type(error).__name__):
                session = _mock_session()
                session.discover.side_effect = error

                with _patch_stdio_client(session):
                    async with create_connected_server_and_client_session(server) as client:
                        result = await client.call_tool("adp_discover", {})

                msg = result.content[0].text
                self.assertTrue(result.isError)
                self.assertIn(error.message, msg)
                self.assertIn("Hint:", msg)
                self.assertIn(expected_hint_fragment, msg)

    async def test_error_without_hint_for_unknown_code(self) -> None:
        session = _mock_session()
        session.discover.side_effect = ParseError("bad json")
        server = create_server("/fake/config")

        with _patch_stdio_client(session):
            async with create_connected_server_and_client_session(server) as client:
                result = await client.call_tool("adp_discover", {})

        self.assertTrue(result.isError)
        self.assertIn("bad json", result.content[0].text)
        self.assertNotIn("Hint:", result.content[0].text)


# ===========================================================================


class TestIntentValidationFormatting(unittest.IsolatedAsyncioTestCase):
    """Tests for agent-friendly intent validation error formatting."""

    async def test_projections_object_format_gives_clear_error(self) -> None:
        """Agent passes [{"fieldId": "x"}] instead of ["x"] for projections."""
        session = _mock_session()
        server = create_server("/fake/config")
        intent = {
            "intentClass": "QUERY",
            "resourceId": "com.acme:users",
            "predicates": {"fieldId": "id", "op": "EQ", "value": 1},
            "projections": [
                {"fieldId": "user_id"},
                {"fieldId": "name"},
                {"fieldId": "email"},
                {"fieldId": "status"},
            ],
        }

        with _patch_stdio_client(session):
            async with create_connected_server_and_client_session(server) as client:
                result = await client.call_tool("adp_execute", {"intent": intent})

        self.assertFalse(session.execute.called)
        self.assertTrue(result.isError)
        error_text = result.content[0].text
        # Should contain our formatted prefix
        self.assertIn("Intent validation failed", error_text)
        # Should mention projections path
        self.assertIn("projections", error_text)
        # Should NOT contain raw Pydantic URL noise
        self.assertNotIn("pydantic.dev", error_text)
        # Should NOT contain the internal model name
        self.assertNotIn("Arguments", error_text)

    async def test_error_aggregation_truncates(self) -> None:
        """Many repeated errors should be aggregated, not listed individually."""
        session = _mock_session()
        server = create_server("/fake/config")
        # 6 bad projection items → 6 errors, should be truncated to 3 + "and 3 more"
        intent = {
            "intentClass": "QUERY",
            "resourceId": "com.acme:users",
            "predicates": {"fieldId": "id", "op": "EQ", "value": 1},
            "projections": [{"fieldId": f"f{i}"} for i in range(6)],
        }

        with _patch_stdio_client(session):
            async with create_connected_server_and_client_session(server) as client:
                result = await client.call_tool("adp_execute", {"intent": intent})

        self.assertTrue(result.isError)
        error_text = result.content[0].text
        self.assertIn("and 3 more", error_text)

    async def test_valid_intent_still_works(self) -> None:
        """A well-formed intent should pass through RawIntent and execute normally."""
        rows = [{"id": 1}]
        session = _mock_session(execute_result={"results": rows})
        server = create_server("/fake/config")
        intent = {
            "intentClass": "QUERY",
            "resourceId": "com.acme:users",
            "predicates": {"fieldId": "id", "op": "EQ", "value": 1},
            "projections": ["id", "name"],
        }

        with _patch_stdio_client(session):
            async with create_connected_server_and_client_session(server) as client:
                result = await client.call_tool("adp_execute", {"intent": intent})

        self.assertFalse(result.isError)
        raw = json.loads(result.content[0].text)
        self.assertEqual(raw["results"], rows)
        self.assertTrue(session.execute.called)
