---
name: adp
description: "Guide for using ADP (Autonomous Data Protocol) tools to discover, query, and manage structured data resources. Use when: user asks about data resources, wants to look up records, query datasets, create or update data entries, or check what data is available."
user-invocable: true
---

# ADP Data Access

ADP provides 4 tools for interacting with data resources managed by the ADP Hypervisor. Resources are organized by domain (e.g., `release:releases`, `system:people`) and support CRUD-like operations called **intent classes**.

## When to Use

✅ **USE these tools when:**
- User asks "what data do we have?" or "show me available resources" → `adp_discover`
- User asks about the schema or fields of a resource → `adp_describe`
- User wants to look up a specific record by key → `adp_execute` with LOOKUP
- User wants to search/filter/list records → `adp_execute` with QUERY
- User wants to create new records or upload data → `adp_execute` with INGEST
- User wants to update existing records → `adp_execute` with REVISE

❌ **DON'T use when:**
- User is asking about general knowledge (not stored data)
- The task doesn't involve reading or writing structured data

## Quick Start: The Recommended Workflow

Always follow this progression for unfamiliar resources:

```
1. adp_discover  →  Find what resources exist
2. adp_describe  →  Learn the schema and capabilities for a specific resource + intent
3. adp_execute   →  Execute the intent
```

Skip to step 3 if you already know the resource schema from a previous interaction in this conversation.

> **Tip:** `adp_validate` is optional but useful before destructive writes (INGEST/REVISE) to catch errors early.

---

## Tool Reference

### adp_discover — Browse Available Resources

Find what data resources are available and what operations they support.

**Parameters (all optional):**

| Parameter | Type | Description |
|-----------|------|-------------|
| `domain_prefix` | string | Filter by domain (e.g., `"release"`, `"system"`) |
| `intent_class` | string | Filter by operation: `LOOKUP`, `QUERY`, `INGEST`, `REVISE` |
| `keyword` | string | Keyword search across resource descriptions |

**Example:**
```json
{ "domain_prefix": "release" }
```

**Returns:** List of resources with `resourceId`, `intentClasses[]`, and `description`.

---

### adp_describe — Get Resource Schema

Get the field definitions, predicate capabilities, and mutable fields for a specific resource and intent class. **Call this before your first execute** to learn the correct field names and operators.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `resource_id` | string | ✅ | Resource in `domain:alias` format (e.g., `"release:releases"`) |
| `intent_class` | string | ✅ | One of: `LOOKUP`, `QUERY`, `INGEST`, `REVISE` |

**Example:**
```json
{ "resource_id": "release:releases", "intent_class": "QUERY" }
```

**Returns:** `usageContract` with `fields[]`, `capabilities.predicates[]`, `capabilities.projections[]`, and `capabilities.mutables[]`.

---

### adp_validate — Dry-Run Validation

Check if an intent is well-formed before executing. Returns validation issues with severity and correction hints.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `intent` | object | ✅ | The full intent object (same structure as `adp_execute`) |

**Returns:** `{ valid: boolean, issues?: [...] }`

---

### adp_execute — Execute an Intent

Execute a data operation. The `intent` structure varies by intent class (see below).

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `intent` | object | ✅ | Intent object with `intentClass` and `resourceId` |
| `cursor` | string | | Pagination cursor from a previous response's `nextCursor` |

**Returns:** `{ results: [...], nextCursor?: string }`

---

## Intent Class Reference

### LOOKUP — Get a Single Record by Key

Use when you know the exact key (e.g., a filename or ID).

```json
{
  "intent": {
    "intentClass": "LOOKUP",
    "resourceId": "system:people",
    "key": {
      "fieldId": "path",
      "value": "members.csv"
    }
  }
}
```

> **Key structure:** `{ fieldId: string, value: string }` — no `op` field needed for LOOKUP keys.

---

### QUERY — Search with Filters

Use to list or search records with predicate filters.

**Simple query (single predicate):**
```json
{
  "intent": {
    "intentClass": "QUERY",
    "resourceId": "release:releases",
    "predicates": {
      "fieldId": "path",
      "op": "EQ",
      "value": "/"
    }
  }
}
```

**Compound query (AND/OR):**
```json
{
  "intent": {
    "intentClass": "QUERY",
    "resourceId": "release:candidates",
    "predicates": {
      "op": "AND",
      "predicates": [
        { "fieldId": "path", "op": "CONTAINS", "value": "rc1" },
        { "fieldId": "size", "op": "GT", "value": 0 }
      ]
    },
    "limit": 10
  }
}
```

**Supported predicate operators:** `EQ`, `NEQ`, `GT`, `LT`, `GTE`, `LTE`, `CONTAINS`, `IN`, `LIKE`, `ILIKE`

**Optional QUERY fields:**
- `projections`: `string[]` — field names to include in results
- `orderBy`: `[{ fieldId: string, direction: "ASC" | "DESC" }]`
- `limit`: `number` — max results to return

---

### INGEST — Create New Records

Use to upload new files or create new data entries. Payload is an **array** of items.

```json
{
  "intent": {
    "intentClass": "INGEST",
    "resourceId": "release:releases",
    "payload": [
      {
        "path": "gravitino-1.0.0.json",
        "content": "{\"version\": \"1.0.0\", \"status\": \"released\"}"
      }
    ]
  }
}
```

> ✅ `payload` is always an **array**, even for a single item.
>
> ❌ Don't pass `payload` as a single object — it must be wrapped in `[]`.

---

### REVISE — Update Existing Records

Use to modify existing records. Uses predicates to identify which record(s) to update.

```json
{
  "intent": {
    "intentClass": "REVISE",
    "resourceId": "release:releases",
    "predicates": {
      "fieldId": "path",
      "op": "EQ",
      "value": "gravitino-1.0.0.json"
    },
    "payload": {
      "content": "{\"version\": \"1.0.0\", \"status\": \"archived\"}"
    }
  }
}
```

> ✅ REVISE `payload` is a single **object** (not an array).
>
> ❌ Don't wrap REVISE payload in `[]` — unlike INGEST, it's a flat object.

---

## Blob Storage Conventions

All resources in this deployment use a **blob storage backend** (local filesystem). This means:

### Convention Fields (Automatically Available)

These fields are provided by the storage backend — you do **not** need to define or specify them:

| Field | Type | Available In | Description |
|-------|------|-------------|-------------|
| `path` | STRING | All intents | File path relative to resource root |
| `size` | INTEGER | QUERY results | File size in bytes |
| `last_modified` | TIMESTAMP | QUERY results | Last modification time |
| `created_at` | TIMESTAMP | QUERY results | Creation time |
| `content_type` | STRING | QUERY results | MIME type |
| `is_directory` | BOOLEAN | QUERY results | Whether entry is a directory |
| `content` | STRING | LOOKUP results | File content (UTF-8 text or base64) |
| `content_encoding` | STRING | LOOKUP results | `"utf-8"` or `"base64"` |

### Path-Based Access Patterns

```
QUERY  with path EQ "/"           → List root directory entries
QUERY  with path EQ "subdir/"     → List entries in a subdirectory
LOOKUP with path = "file.json"    → Get file content
INGEST with path = "new-file.json" + content = "..."  → Create file
REVISE with path predicate + content payload           → Update file
```

### Content Encoding

- **Text files** (`.json`, `.csv`, `.txt`, `.md`): returned as UTF-8 with `content_encoding: "utf-8"`
- **Binary files**: returned as base64 with `content_encoding: "base64"`
- **INGEST/REVISE**: always send `content` as a plain UTF-8 string for text files

---

## Common Patterns

### Pattern 1: List All Files in a Resource

```json
{
  "intent": {
    "intentClass": "QUERY",
    "resourceId": "release:releases",
    "predicates": { "fieldId": "path", "op": "EQ", "value": "/" }
  }
}
```

### Pattern 2: Read a Specific File

```json
{
  "intent": {
    "intentClass": "LOOKUP",
    "resourceId": "release:releases",
    "key": { "fieldId": "path", "value": "gravitino-1.0.0.json" }
  }
}
```

### Pattern 3: Create a JSON Record

```json
{
  "intent": {
    "intentClass": "INGEST",
    "resourceId": "release:releases",
    "payload": [{
      "path": "gravitino-1.1.0.json",
      "content": "{\"version\":\"1.1.0\",\"status\":\"planning\",\"manager\":\"minghuang\"}"
    }]
  }
}
```

### Pattern 4: Update a Record's Content

```json
{
  "intent": {
    "intentClass": "REVISE",
    "resourceId": "release:releases",
    "predicates": { "fieldId": "path", "op": "EQ", "value": "gravitino-1.1.0.json" },
    "payload": {
      "content": "{\"version\":\"1.1.0\",\"status\":\"in_progress\",\"manager\":\"minghuang\"}"
    }
  }
}
```

### Pattern 5: Search Files by Name Pattern

```json
{
  "intent": {
    "intentClass": "QUERY",
    "resourceId": "release:candidates",
    "predicates": { "fieldId": "path", "op": "CONTAINS", "value": "rc1" }
  }
}
```

### Pattern 6: Look Up Team Members

```json
{
  "intent": {
    "intentClass": "LOOKUP",
    "resourceId": "system:people",
    "key": { "fieldId": "path", "value": "members.csv" }
  }
}
```

---

## ✅ Correct / ❌ Incorrect Examples

### LOOKUP key format
```
✅ "key": { "fieldId": "path", "value": "file.json" }
❌ "key": { "fieldId": "path", "op": "EQ", "value": "file.json" }    ← no "op" in LOOKUP key
❌ "key": "file.json"                                                  ← key must be an object
```

### INGEST payload
```
✅ "payload": [{ "path": "a.json", "content": "..." }]    ← array of items
❌ "payload": { "path": "a.json", "content": "..." }       ← must be array, not object
```

### REVISE payload
```
✅ "payload": { "content": "new content" }                  ← single object
❌ "payload": [{ "content": "new content" }]                ← not an array for REVISE
```

### Resource ID format
```
✅ "resourceId": "release:releases"     ← domain:alias
❌ "resourceId": "releases"             ← missing domain prefix
❌ "resourceId": "release/releases"     ← wrong separator, use colon
```

### QUERY predicate operators
```
✅ "op": "EQ"         ← uppercase operator
❌ "op": "eq"          ← operators are case-sensitive, must be uppercase
❌ "op": "EQUALS"      ← not a valid operator, use "EQ"
```

---

## Gotchas & Tips

1. **Always discover first** if you don't know the available resources — don't guess resource IDs.
2. **Describe before first execute** to learn the correct field names and predicate capabilities for the specific resource and intent class.
3. **RBAC is enforced** — some resources may not be visible or writable depending on the configured user's role. If you get an authorization error, inform the user about the permission limitation.
4. **Pagination** — if `nextCursor` is present in results, there are more records. Pass it as the `cursor` parameter in a follow-up `adp_execute` call.
5. **Empty QUERY results** are normal — they mean no files match the predicates, not that the resource is broken.
6. **Content is always a string** — when ingesting JSON data, serialize it to a JSON string first (don't pass raw objects as `content`).
7. **Path values** — use just the filename (e.g., `"report.json"`), not a full filesystem path. Use `"/"` to list the root directory.
