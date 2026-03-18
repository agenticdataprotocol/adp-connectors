#!/usr/bin/env python3
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

"""Mock ADP Hypervisor for testing.

Reads NDJSON requests from stdin, sends NDJSON responses to stdout.
Supports: adp.initialize, adp.ping, adp.discover, adp.describe,
adp.validate, adp.execute, and a special test.error method.
"""
import json
import sys


def handle(request):
    method = request.get("method", "")
    req_id = request.get("id")
    params = request.get("params", {})

    if method == "adp.initialize":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2026-01-20",
                "capabilities": {},
                "serverInfo": {"name": "mock-hypervisor", "version": "0.0.1"},
            },
        }
    elif method == "adp.ping":
        return {"jsonrpc": "2.0", "id": req_id, "result": {}}
    elif method == "adp.discover":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "resources": [
                    {
                        "resourceId": "demo:notes",
                        "version": 1,
                        "intentClasses": ["LOOKUP", "QUERY", "INGEST", "REVISE"],
                        "description": "Analyst notes and working documents",
                    }
                ]
            },
        }
    elif method == "adp.describe":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "resourceId": params.get("resourceId", ""),
                "version": 1,
                "intentClass": params.get("intentClass", "QUERY"),
                "usageContract": {
                    "fields": [
                        {"fieldId": "path", "type": "STRING", "description": "File path"},
                    ],
                    "capabilities": {"predicates": [], "projections": [], "mutables": []},
                },
            },
        }
    elif method == "adp.validate":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"valid": True, "issues": []},
        }
    elif method == "adp.execute":
        intent = params.get("intent", {})
        intent_class = intent.get("intentClass", "")
        if intent_class == "INGEST":
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {"results": [{"status": "created"}]},
            }
        elif intent_class == "QUERY":
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "results": [{"path": "test.txt", "content": "hello"}]
                },
            }
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"results": []},
        }
    elif method == "test.echo":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"params": params},
        }
    elif method == "test.hang":
        # Deliberately do not send any response to test request timeout
        return None
    elif method == "test.error":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32001, "message": "Resource not found"},
        }
    elif method == "test.exit":
        sys.exit(0)
    else:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"},
        }


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            response = handle(request)
            if response is not None:
                sys.stdout.write(json.dumps(response) + "\n")
                sys.stdout.flush()
        except json.JSONDecodeError:
            error_response = {
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32700, "message": "Parse error"},
            }
            sys.stdout.write(json.dumps(error_response) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
