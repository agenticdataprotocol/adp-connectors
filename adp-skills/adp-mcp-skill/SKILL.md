---
name: adp-mcp-skill
description: >
  Guide for querying and operating on data through the Agentic Data Protocol (ADP) MCP tools.
  This skill teaches how to use adp_discover, adp_describe, adp_validate, and adp_execute
  tools effectively. Use this skill whenever the user wants to explore available data resources,
  query data, look up records, insert new data, or update existing data through ADP — even if
  they don't mention "ADP" explicitly. Triggers include "find data", "query records",
  "look up customer", "insert rows", "update entries", "what data is available",
  "search for similar items", "show me the schema", or any data exploration and manipulation
  task where ADP MCP tools are connected.
---

# ADP Skill — Data Access via Agentic Data Protocol

This skill helps you interact with data through four ADP MCP tools that connect to an ADP
Hypervisor. The Hypervisor is a policy-enforcing gateway that abstracts away backend differences
(SQL databases, MongoDB, vector stores, file systems) behind a single intent-based interface.

## Core Workflow

Always follow this sequence — each step builds on the previous one:

```
discover → describe → validate (optional) → execute
```

1. **Discover** — Find what data resources are available
2. **Describe** — Read the usage contract for a specific resource (field schema, allowed
   operators, required predicates)
3. **Validate** — Dry-run your intent to catch errors before execution (recommended but optional)
4. **Execute** — Run the intent and get results

Skipping `describe` leads to malformed intents because you won't know which fields exist, which
predicates are required, or which operators are allowed. Always describe before building an intent.

## The Four MCP Tools

### 1. `adp_discover` — Browse Available Resources

Find what data is available. Use filters to narrow results.

**Parameters:**
- `domain_prefix` (optional): Filter by domain, e.g. `"com.acme"`
- `intent_class` (optional): `"LOOKUP"`, `"QUERY"`, `"INGEST"`, or `"REVISE"`
- `keyword` (optional): Free-text search across resource names and descriptions
- `cursor` (optional): Pagination cursor from previous response

**When to use:** Start here when you don't know what resources exist, or when the user asks
"what data do we have?" Always discover before describe.

**Example call:**
```json
{
  "domain_prefix": "com.acme",
  "intent_class": "QUERY"
}
```

**Example response:**
```json
{
  "resources": [
    {
      "resourceId": "com.acme:customers",
      "version": 1,
      "intentClasses": ["LOOKUP", "QUERY"],
      "description": "Customer master records"
    },
    {
      "resourceId": "com.acme:orders",
      "version": 1,
      "intentClasses": ["LOOKUP", "QUERY", "INGEST"],
      "description": "Order transactions"
    }
  ],
  "nextCursor": null
}
```

### 2. `adp_describe` — Get the Usage Contract

Returns the schema and capabilities for a resource + intent class combination. This is the
"manual" you must read before building an intent.

**Parameters:**
- `resource_id` (required): Resource identifier in `"domain:alias"` format, e.g. `"demo:customers"`
- `intent_class` (required): `"LOOKUP"`, `"QUERY"`, `"INGEST"`, or `"REVISE"`
- `version` (optional): Schema version (defaults to latest)
- `cursor` (optional): For large field lists

**The response contains:**
- **`fields`** — Available field definitions (id, type, description, sample values)
- **`capabilities.predicates`** — Which fields can be filtered on, whether they're `REQUIRED` or
  `OPTIONAL`, and which operators they support (EQ, GT, IN, LIKE, SIMILAR, etc.)
- **`capabilities.projections`** — Which fields can be included in results
- **`capabilities.mutables`** — Which fields can be written to (for INGEST/REVISE)

**Example response (abbreviated):**
```json
{
  "resourceId": "demo:orders",
  "version": 1,
  "intentClass": "QUERY",
  "usageContract": {
    "fields": [
      { "fieldId": "order_id", "type": "INTEGER", "description": "Unique order identifier" },
      { "fieldId": "status", "type": "STRING", "description": "Order status",
        "metadata": { "samples": ["pending", "shipped", "delivered"], "whitelistOnly": true } }
    ],
    "capabilities": {
      "predicates": [
        { "fieldId": "order_id", "usage": "OPTIONAL", "operators": ["EQ", "IN"] },
        { "fieldId": "status", "usage": "REQUIRED", "operators": ["EQ", "NEQ", "IN"] }
      ],
      "projections": [
        { "fieldId": "order_id" },
        { "fieldId": "status" },
        { "fieldId": "total" }
      ]
    }
  }
}
```

**Pay special attention to:**
- Fields with `usage: "REQUIRED"` in predicates — you **must** include these in your intent
- The `operators` array tells you exactly which comparison operators each field supports
- `samples` and `metadata.whitelistOnly` help you pick valid filter values
- For Blob Storage resources, fields may differ from database-backed resources — always describe
  to learn the actual schema

### 3. `adp_validate` — Dry-Run Check

Validates an intent IR without touching the database. Catches structural errors, missing required
predicates, invalid operators, and policy violations early.

**Parameters:**
- `intent` (required): The full intent IR object (see Intent IR Structure below)

**Response:** `{ "valid": true/false, "issues": [...] }`

Each issue includes `code`, `severity` (BLOCKING/WARNING), `field`, `message`, and
`correctionHint`. Use correction hints to fix your intent and retry.

### 4. `adp_execute` — Run the Intent

Executes the intent and returns results.

**Parameters:**
- `intent` (required): The intent IR object
- `cursor` (optional): Pagination cursor from previous execute response

**Response:** `{ "results": [...], "executionMetadata": {...}, "nextCursor": "..." }`

For **READ** operations (LOOKUP, QUERY), `results` contains an array of matching records:
```json
{
  "results": [
    { "order_id": 1, "customer_id": 42, "status": "pending", "total": 150.0 }
  ],
  "executionMetadata": { "durationMs": 42, "consistency": "STRONG" },
  "nextCursor": null
}
```

For **WRITE** operations (INGEST, REVISE), `results` contains the operation outcome. On access
policy denial, the tool returns an error — explain the limitation to the user rather than retrying.

Pass `nextCursor` back as `cursor` to fetch the next page of results.

## Intent IR Structure

All intents share a common shape. The `intentClass` field determines which variant applies.

### LOOKUP — Fetch a Single Record by Key

Use when retrieving one specific entity by its unique identifier.

```json
{
  "intentClass": "LOOKUP",
  "resourceId": "demo:customers",
  "key": {
    "fieldId": "customer_id",
    "op": "EQ",
    "value": 42
  },
  "projections": ["name", "email", "tier"]
}
```

- `key` must use `"op": "EQ"` with a single scalar value
- Returns 0 or 1 result

### QUERY — Search with Filters

Use when retrieving multiple records matching conditions.

```json
{
  "intentClass": "QUERY",
  "resourceId": "demo:orders",
  "predicates": {
    "op": "AND",
    "predicates": [
      { "fieldId": "status", "op": "EQ", "value": "pending" },
      { "fieldId": "total", "op": "GT", "value": 100.0 }
    ]
  },
  "projections": ["order_id", "customer_id", "total", "status"],
  "orderBy": [{ "fieldId": "total", "direction": "DESC" }],
  "limit": 20
}
```

- `predicates` can be a single predicate or a group with `AND`/`OR`/`NOT`
- Groups nest recursively for complex Boolean logic
- `projections`, `orderBy`, and `limit` are all optional

### INGEST — Insert New Records

Use when creating new data entries.

```json
{
  "intentClass": "INGEST",
  "resourceId": "demo:notes",
  "payload": [
    { "customer_id": 42, "content": "Follow-up call scheduled", "created_by": "agent" },
    { "customer_id": 43, "content": "Issue resolved", "created_by": "agent" }
  ]
}
```

- `payload` is an array of record objects (even for a single record)
- Field names must match the `mutables` from `adp_describe`

### REVISE — Update Existing Records

Use when modifying existing data.

```json
{
  "intentClass": "REVISE",
  "resourceId": "demo:customer_profiles",
  "predicates": {
    "fieldId": "customer_id",
    "op": "EQ",
    "value": 42
  },
  "payload": {
    "churn_risk": "low",
    "last_contact": "2026-03-13"
  }
}
```

- `predicates` identify which records to update
- `payload` is a single object with the fields to change (not an array)

## Predicate Reference

### Simple Predicate
```json
{ "fieldId": "status", "op": "EQ", "value": "active" }
```

### Operators
| Operator | Meaning | Example Value |
|----------|---------|---------------|
| `EQ`     | Equals | `"active"` |
| `NEQ`    | Not equals | `"cancelled"` |
| `GT`     | Greater than | `100` |
| `GTE`    | Greater or equal | `100` |
| `LT`     | Less than | `50.0` |
| `LTE`    | Less or equal | `50.0` |
| `IN`     | Value in list | `["CA", "NY", "TX"]` |
| `LIKE`   | Pattern match (case-sensitive) | `"%smith%"` |
| `ILIKE`  | Pattern match (case-insensitive) | `"%smith%"` |
| `CONTAINS` | Contains substring | `"premium"` |
| `SIMILAR` | Vector/semantic similarity | See below |

### Predicate Groups (Boolean Logic)
```json
{
  "op": "AND",
  "predicates": [
    { "fieldId": "status", "op": "EQ", "value": "active" },
    {
      "op": "OR",
      "predicates": [
        { "fieldId": "tier", "op": "EQ", "value": "premium" },
        { "fieldId": "total_spend", "op": "GT", "value": 10000 }
      ]
    }
  ]
}
```

### Vector Similarity Search

For resources backed by vector stores, use the `SIMILAR` operator:

```json
{
  "fieldId": "embedding",
  "op": "SIMILAR",
  "value": {
    "vector": [0.8, 0.1, 0.3],
    "top": 5,
    "threshold": 0.7,
    "distanceFunction": "cosine"
  }
}
```

You can also search by text (if the backend supports it):
```json
{
  "fieldId": "embedding",
  "op": "SIMILAR",
  "value": {
    "text": "wireless noise-cancelling headphones",
    "top": 10
  }
}
```

**Tip:** To search by similarity to an existing record, first LOOKUP the record to get its
embedding vector, then use that vector in a SIMILAR predicate on a QUERY intent.

## Common Patterns

### Pattern 1: Cross-Resource Correlation

Chain multiple intents to correlate data across backends:

```
1. QUERY demo:orders → get pending orders with customer_ids
2. LOOKUP demo:customers → enrich with customer names for each customer_id
3. LOOKUP demo:customer_profiles → get CRM data from MongoDB
```

**Batch LOOKUP tip:** When correlating across resources, extract the list of IDs from the QUERY
results, then issue individual LOOKUP calls for each ID. If the list is large, consider using a
QUERY with an `IN` predicate instead of many LOOKUPs:

```json
{
  "intentClass": "QUERY",
  "resourceId": "demo:customers",
  "predicates": { "fieldId": "customer_id", "op": "IN", "value": [42, 43, 44] },
  "projections": ["customer_id", "name", "email"]
}
```

### Pattern 2: Similarity-Driven Discovery

Find similar items using vector embeddings:

```
1. LOOKUP demo:items → get the embedding vector for a known item
2. QUERY demo:items with SIMILAR predicate → find top-N similar items
```

### Pattern 3: Write with Access Awareness

When an INGEST or REVISE fails with an access policy error, explain the limitation to the user
transparently rather than retrying. The Hypervisor enforces role-based access — some resources
may be read-only for the current user.

### Pattern 4: Backend-Agnostic Usage

ADP abstracts away backend differences. The same intent structure works whether the resource is
backed by PostgreSQL, MongoDB, a vector store, or a local filesystem. However, the available
fields, operators, and capabilities vary per resource — this is why `adp_describe` is essential
before building any intent. Never assume field names; always check the usage contract first.

## Data Type Notes

- **DATE** and **TIMESTAMP** fields: Use ISO 8601 format strings (e.g., `"2026-03-13"` for dates,
  `"2026-03-13T14:30:00Z"` for timestamps). Check the `format` in field metadata when available.
- **VECTOR** fields: Used with the `SIMILAR` operator. The `metadata.vector` section in the
  describe response tells you the expected dimensions and distance function.
- **BLOB** fields: Represent file content in Blob Storage resources.

## Error Handling

When `adp_validate` or `adp_execute` returns issues, use them to self-correct:

| Issue Code | Meaning | Fix |
|------------|---------|-----|
| `MISSING_REQUIRED_PREDICATE` | A required predicate is missing | Add the predicate from the describe contract |
| `FIELD_NOT_FOUND` | Field doesn't exist | Check field names in describe response |
| `FIELD_NOT_PERMITTED` | Field not allowed for this operation | Remove the field |
| `INVALID_OPERATOR` | Operator not supported for this field | Use an operator from the describe capabilities |
| `INVALID_VALUE` | Value format is wrong | Check field type and samples |
| `INVALID_FORMAT` | Structural issue with the intent | Review intent structure |
| `CARDINALITY_EXCEEDED` | Too many distinct values | Narrow your filter |

**Self-correction loop:** If validation fails, read the `correctionHint` in each issue, fix the
intent accordingly, and validate again before executing.

## Pagination

Both `adp_discover` and `adp_execute` support cursor-based pagination. When a response includes
`nextCursor`, pass it as the `cursor` parameter in your next call to get the next page. Continue
until `nextCursor` is absent or null.

## Tips

- **Always discover first** if you're unsure what resources exist
- **Always describe before building an intent** — the usage contract is your source of truth
- **Check `REQUIRED` predicates** — omitting them causes validation failure
- **Use `projections`** to request only the fields you need; this reduces response size
- **Validate complex intents** before executing, especially for INGEST and REVISE
- **Respect `whitelistOnly` fields** — only use values from the `samples` list
- **Handle pagination** — don't assume all results come in one response
