#!/usr/bin/env python3
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
                        "resourceId": "release:releases",
                        "version": 1,
                        "intentClasses": ["LOOKUP", "QUERY", "INGEST", "REVISE"],
                        "description": "Release tracking records",
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
                        {"fieldId": "version", "type": "STRING", "description": "Version"},
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
                    "results": [{"version": "1.2.0", "status": "planning"}]
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
