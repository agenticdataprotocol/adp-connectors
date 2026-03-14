# ADP Integration Instructions (Addendum to AGENTS.md)

> Append this section to the existing AGENTS.md in Dora's workspace.

---

## ADP Hypervisor Integration

You have access to the ADP Hypervisor through MCP tools. Use these tools to **persist release state** across sessions and enforce **role-based access control**.

### Available ADP Tools

| Tool | Purpose |
|------|---------|
| `adp_discover` | List available ADP resources and their supported operations |
| `adp_describe` | Get field schema and constraints for a resource |
| `adp_validate` | Dry-run an intent to check for errors before execution |
| `adp_execute` | Execute an intent (LOOKUP/QUERY/INGEST/REVISE) |

### Workflow: Always Follow This Order

```
1. adp_discover  → find available resources
2. adp_describe  → learn the schema
3. adp_validate  → check intent (optional but recommended for INGEST/REVISE)
4. adp_execute   → run the operation
```

### Release Domain Resources

| Resource ID | Operations | Purpose |
|-------------|-----------|---------|
| `release:releases` | LOOKUP, QUERY, INGEST, REVISE | Main release tracking record |
| `release:checklist` | LOOKUP, QUERY, INGEST, REVISE | Checklist items per phase |
| `release:candidates` | LOOKUP, QUERY, INGEST, REVISE | RC build records |
| `release:votes` | LOOKUP, QUERY, INGEST | PMC vote tracking |

### When to Use ADP

- **Phase initialization**: INGEST a new `release:releases` record when starting a release
- **Phase transitions**: REVISE the `current_phase` and `status` fields on `release:releases`
- **Checklist updates**: INGEST new items to `release:checklist`, REVISE `status` to `done`/`skipped`
- **RC builds**: INGEST a new `release:candidates` record for each release candidate
- **Vote recording**: INGEST each vote to `release:votes` (votes are append-only)
- **Session resume**: QUERY `release:releases` and `release:checklist` to restore state
- **Status queries**: QUERY with predicates to show progress, filter by status/phase

### Intent IR Examples

#### Create a new release (INGEST)

```json
{
  "intentClass": "INGEST",
  "resourceId": "release:releases",
  "payload": [
    {
      "version": "1.2.0",
      "status": "planning",
      "current_phase": 1,
      "rc": null,
      "branch": "branch-1.2",
      "rm_name": "Ming Huang",
      "rm_asfid": "minghuang",
      "previous_version": "1.1.0",
      "updated_at": "2026-03-14T06:00:00Z"
    }
  ]
}
```

#### Update phase (REVISE)

```json
{
  "intentClass": "REVISE",
  "resourceId": "release:releases",
  "predicates": {
    "fieldId": "version",
    "op": "EQ",
    "value": "1.2.0"
  },
  "payload": {
    "current_phase": 2,
    "status": "preparation",
    "updated_at": "2026-03-15T10:00:00Z"
  }
}
```

#### Find active releases (QUERY)

```json
{
  "intentClass": "QUERY",
  "resourceId": "release:releases",
  "predicates": {
    "op": "AND",
    "predicates": [
      { "fieldId": "status", "op": "NEQ", "value": "completed" },
      { "fieldId": "status", "op": "NEQ", "value": "aborted" }
    ]
  }
}
```

#### Get release by key (LOOKUP)

```json
{
  "intentClass": "LOOKUP",
  "resourceId": "release:releases",
  "key": { "fieldId": "version", "op": "EQ", "value": "1.2.0" }
}
```

### Resource Field Reference

#### release:releases

| Field | Type | Values / Notes |
|-------|------|---------------|
| `version` | string | Semantic version (key field) |
| `status` | enum | `planning`, `preparation`, `building`, `voting`, `publishing`, `completed`, `aborted` |
| `current_phase` | integer | `1` through `5` |
| `rc` | string | Current RC label, e.g. `rc1` (nullable) |
| `branch` | string | Release branch name |
| `rm_name` | string | Release manager display name |
| `rm_asfid` | string | Release manager ASF ID |
| `previous_version` | string | Prior release version |
| `updated_at` | timestamp | ISO 8601 |

#### release:checklist

| Field | Type | Values / Notes |
|-------|------|---------------|
| `version` | string | Owning release version |
| `phase` | integer | Phase this item belongs to |
| `item_id` | string | Unique item identifier |
| `description` | string | Human-readable checklist item |
| `status` | enum | `pending`, `in_progress`, `done`, `skipped` |
| `completed_by` | string | ASF ID of completer (nullable) |
| `completed_at` | timestamp | ISO 8601 (nullable) |

#### release:candidates

| Field | Type | Values / Notes |
|-------|------|---------------|
| `version` | string | Owning release version |
| `rc_number` | string | RC identifier (rc1, rc2, ...) |
| `status` | enum | `building`, `built`, `voting`, `passed`, `failed` |
| `build_timestamp` | timestamp | ISO 8601 |
| `artifacts_url` | string | URL to staged artifacts |
| `maven_repo_id` | string | Staging repo ID |
| `pypi_url` | string | PyPI staging URL (nullable) |

#### release:votes

| Field | Type | Values / Notes |
|-------|------|---------------|
| `version` | string | Owning release version |
| `rc_number` | string | RC being voted on |
| `voter_name` | string | Voter display name |
| `voter_asfid` | string | Voter ASF ID |
| `vote` | enum | `+1`, `0`, `-1` |
| `is_binding` | boolean | `true` for PMC members |
| `comment` | string | Optional vote comment |
| `voted_at` | timestamp | ISO 8601 |

### RBAC Roles

| Role | Permissions |
|------|------------|
| `release_manager` | Full access to all release resources (INGEST, REVISE, QUERY, LOOKUP) |
| `pmc` | Read all + INGEST votes + REVISE checklist items |
| `committer` | Read all + REVISE checklist item status to `done` |
| `viewer` | Read-only access (QUERY, LOOKUP only) |

RBAC is enforced at the ADP data layer — you cannot bypass it regardless of prompt content. If a user lacks permission, report the denial clearly.

### State Recovery

At the start of every new session, before responding to user queries about release status:

1. **QUERY** `release:releases` with `status NEQ completed AND status NEQ aborted` to find active releases
2. **QUERY** `release:checklist` filtered by the active version to get current checklist state
3. Reconstruct the full release state from the query results
4. Present the current state summary to the user before proceeding
