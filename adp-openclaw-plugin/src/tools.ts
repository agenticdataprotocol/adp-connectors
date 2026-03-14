// Copyright 2026 Datastrato, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * ADP tool registrations.
 *
 * Registers 4 tools that bridge ADP Hypervisor operations as native
 * OpenClaw tools, callable by any agent (including Dora).
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

import type { HypervisorClient } from "./client.js";
import type { DiscoverFilter, Intent, IntentClass } from "./types.js";

type ClientGetter = () => HypervisorClient;

// JSON Schema helpers (plain objects — no external dependency needed)
const str = (description: string) => ({ type: "string" as const, description });
const num = (description: string) => ({ type: "number" as const, description });
const obj = (
  properties: Record<string, unknown>,
  opts?: { required?: string[]; additionalProperties?: boolean; description?: string },
) => ({
  type: "object" as const,
  properties,
  ...(opts?.required ? { required: opts.required } : {}),
  ...(opts?.additionalProperties !== undefined ? { additionalProperties: opts.additionalProperties } : {}),
  ...(opts?.description ? { description: opts.description } : {}),
});

export function registerAdpTools(api: OpenClawPluginApi, getClient: ClientGetter): void {
  // ─── adp_discover ───
  api.registerTool({
    name: "adp_discover",
    label: "ADP Discover",
    description:
      "Browse available ADP data resources. Returns a list of resources with their IDs, " +
      "supported intent classes, and descriptions. Use this to find what data is available " +
      "before calling adp_describe.",
    parameters: obj({
      domain_prefix: str("Filter resources by domain prefix (e.g., 'release')"),
      intent_class: str("Filter by intent class: LOOKUP, QUERY, INGEST, or REVISE"),
      keyword: str("Filter resources by keyword search"),
    }),
    async execute(_toolCallId, params) {
      const { domain_prefix, intent_class, keyword } = params as {
        domain_prefix?: string;
        intent_class?: string;
        keyword?: string;
      };

      const filter: DiscoverFilter = {};
      if (domain_prefix) filter.domainPrefix = domain_prefix;
      if (intent_class) filter.intentClass = intent_class as IntentClass;
      if (keyword) filter.keyword = keyword;

      const client = getClient();
      const result = await client.discover(Object.keys(filter).length > 0 ? filter : undefined);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  });

  // ─── adp_describe ───
  api.registerTool({
    name: "adp_describe",
    label: "ADP Describe",
    description:
      "Get the usage contract for a specific ADP resource and intent class. " +
      "Returns field definitions, predicate capabilities, and mutable fields. " +
      "Call this before adp_validate/adp_execute to understand the resource schema.",
    parameters: obj(
      {
        resource_id: str('The resource identifier in "domain:alias" format (e.g., "release:releases")'),
        intent_class: str("The intent class: LOOKUP, QUERY, INGEST, or REVISE"),
        version: num("Specific resource schema version"),
      },
      { required: ["resource_id", "intent_class"] },
    ),
    async execute(_toolCallId, params) {
      const { resource_id, intent_class, version } = params as {
        resource_id: string;
        intent_class: string;
        version?: number;
      };

      const client = getClient();
      const result = await client.describe(resource_id, intent_class as IntentClass, version);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  });

  // ─── adp_validate ───
  api.registerTool({
    name: "adp_validate",
    label: "ADP Validate",
    description:
      "Validate an ADP intent before execution. Checks field constraints, required " +
      "predicates, and RBAC permissions. Returns validation issues if any. " +
      "Use this to catch errors before calling adp_execute.",
    parameters: obj(
      {
        intent: obj(
          {
            intentClass: str("Intent type: LOOKUP, QUERY, INGEST, or REVISE"),
            resourceId: str('Target resource in "domain:alias" format'),
          },
          {
            required: ["intentClass", "resourceId"],
            additionalProperties: true,
            description:
              "The full intent object. Structure varies by intentClass: " +
              "LOOKUP needs {key}, QUERY needs {predicates}, " +
              "INGEST needs {payload: [...]}, REVISE needs {predicates, payload}",
          },
        ),
      },
      { required: ["intent"] },
    ),
    async execute(_toolCallId, params) {
      const { intent } = params as { intent: Intent };

      const client = getClient();
      const result = await client.validate(intent);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  });

  // ─── adp_execute ───
  api.registerTool({
    name: "adp_execute",
    label: "ADP Execute",
    description:
      "Execute an ADP intent to read or write data. Supports 4 intent types: " +
      "LOOKUP (get by key), QUERY (search with predicates), " +
      "INGEST (create new records), REVISE (update existing records). " +
      "Returns the operation results. Consider calling adp_validate first.",
    parameters: obj(
      {
        intent: obj(
          {
            intentClass: str("Intent type: LOOKUP, QUERY, INGEST, or REVISE"),
            resourceId: str('Target resource in "domain:alias" format'),
          },
          {
            required: ["intentClass", "resourceId"],
            additionalProperties: true,
            description:
              "The full intent object. Structure varies by intentClass: " +
              "LOOKUP: {intentClass, resourceId, key: {fieldId, op:'EQ', value}}. " +
              "QUERY: {intentClass, resourceId, predicates: {fieldId, op, value}, limit?}. " +
              "INGEST: {intentClass, resourceId, payload: [{field: value, ...}]}. " +
              "REVISE: {intentClass, resourceId, predicates: {...}, payload: {field: newValue}}.",
          },
        ),
        cursor: str("Pagination cursor from a previous response"),
      },
      { required: ["intent"] },
    ),
    async execute(_toolCallId, params) {
      const { intent, cursor } = params as { intent: Intent; cursor?: string };

      const client = getClient();
      const result = await client.execute(intent, cursor);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  });

  api.logger.info("adp-bridge: registered 4 tools (discover, describe, validate, execute)");
}
