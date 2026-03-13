# Customer Churn Investigation

## Overview

This scenario walks through a customer churn investigation performed by a data
analyst (`demo` user) using an AI agent with the **ADP MCP** server. The analyst
investigates **Carol White** — a premium customer with a pending unfulfilled order
and a high churn risk. Her data is spread across four backends, and the AI agent
orchestrates a sequence of ADP calls to build a complete picture before writing a
targeted follow-up note.

The scenario closes by demonstrating ACCESS policy enforcement: the same INGEST
attempt succeeds on a writable resource (`demo:notes`) but is denied on a
restricted one (`demo:reports`) — all without switching users.

The scenario covers:

- `adp.discover` for resource discovery
- LOOKUP and QUERY intents across PostgreSQL, MongoDB, pgvector, and local filesystem
- Vector similarity search (two-step: fetch embedding → SIMILAR query)
- INGEST for writing files
- ACCESS policy enforcement without switching users

---

## Steps

### Step 1: Discover Available Data Sources

**Context:** The analyst begins by surveying what data is available before
diving into specific queries.

**Prompt:**

> Show me all the ADP data sources I have access to

**Expected Outcome:** `adp.discover` returns 8 resources across 4 backends:

| Backend          | Resources                                         |
|:-----------------|:--------------------------------------------------|
| `pg_demo`        | `demo:customers`, `demo:products`, `demo:orders`  |
| `pgvector_demo`  | `demo:items`                                      |
| `mongo_demo`     | `demo:customer_profiles`                          |
| `localfs_demo`   | `demo:invoices`, `demo:notes`, `demo:reports`     |

Each resource lists its supported intent classes. `demo:reports` and `demo:notes`
support LOOKUP / QUERY / INGEST / REVISE, while `demo:customer_profiles` supports
LOOKUP / QUERY only — signalling a read-only CRM source.

---

### Step 2: Find Orders Needing Follow-Up

**Context:** The analyst queries for pending orders to identify customers who
need attention. The AI client also looks up customer names from the customers
table to enrich the results.

**Prompt:**

> Show me all pending orders

**Expected Outcome:** QUERY on `demo:orders` with `status = "pending"` returns
2 rows:

| Order | customer_id | Product           | Qty | Total  | Ordered At  |
|:------|:------------|:------------------|:----|:-------|:------------|
| #5    | 3           | Wireless Mouse    | 1   | $29.99 | 2025-12-10  |
| #7    | 4           | Mechanical Keyboard | 1 | $89.99 | 2025-12-15  |

The AI then performs LOOKUP on `demo:customers` for `customer_id = 3` and
`customer_id = 4`, resolving the names to **Carol White** and **David Brown**.
Carol's order is older (Dec 10) and lower value — making it the stronger
churn signal — so she becomes the focus of the investigation.

---

### Step 3: Assess Churn Risk via CRM

**Context:** The analyst retrieves Carol White's CRM profile to understand her
engagement and risk level, connecting the order record to her profile via email.

**Prompt:**

> Get the CRM profile for Carol White

**Expected Outcome:** LOOKUP on `demo:customer_profiles` with
`email = "carol@example.com"` (or `customer_id = 3`) returns:

| Field                  | Value       |
|:-----------------------|:------------|
| `segment`              | premium     |
| `lifetime_value`       | $92.49      |
| `churn_risk`           | **high**    |
| `last_purchase_days_ago` | 52        |

This confirms Carol is a premium customer with a high churn risk. Her pending,
unshipped order sitting for 52 days is a strong dissatisfaction signal that
warrants immediate outreach.

---

### Step 4: Find Product Recommendations via Vector Similarity

**Context:** To personalise the outreach, the analyst finds products similar to
Carol's pending order (Wireless Mouse). This is a two-step operation: first
retrieve the item's embedding vector, then run the similarity search.

**Prompt:**

> Find products similar to what Carol has been buying

**Expected Outcome (two steps):**

**Step 4a** — LOOKUP on `demo:items` where `title = "Wireless Mouse"` returns
the item's embedding vector: `[0.9, 0.7, 0.2]` (high tech affinity, medium
office affinity, low home affinity).

**Step 4b** — QUERY on `demo:items` with a SIMILAR predicate using
`[0.9, 0.7, 0.2]`, top 4, excluding the Wireless Mouse itself. Results by
cosine similarity:

1. Mechanical Keyboard — Electronics, $89.99
2. Monitor Arm — Electronics, $59.99
3. Laptop Stand — Electronics, $27.99
4. USB-C Hub — Electronics, $45.00

These are the recommended products to include in the outreach message.

---

### Step 5: Read the Pending Invoice

**Context:** Before drafting the outreach note, the analyst reads Carol's
pending invoice to verify the order details match the database records.

**Prompt:**

> Read the invoice for Carol's pending order

**Expected Outcome:** QUERY on `demo:invoices` with `path = "pending"` lists the
files in the pending invoice directory. LOOKUP with
`path = "pending/invoice-005.txt"` returns the file content:

```
INVOICE #005
Date: 2025-12-10
Status: PENDING
Bill To: Carol White, carol@example.com, San Francisco, CA
Items: 1 x Wireless Mouse $29.99
Total: $29.99
```

The order details match the PostgreSQL records, confirming the data is
consistent across backends.

---

### Step 6: Write an Outreach Note and Observe Access Control

**Context:** The analyst drafts a customer outreach note and first attempts to
save it as a business report — a resource restricted to the admin role — before
saving it correctly to the notes resource.

**Prompt:**

> Create a customer outreach note for Carol White and save it as a report

**Expected Outcome (two steps):**

**Step 6a** — INGEST on `demo:reports` → **ACCESS DENIED**. The `demo` user
holds the `default` role, which carries no INGEST permission on `demo:reports`
(admin-only write). The hypervisor rejects the request before touching the
filesystem and returns an access error.

**Step 6b** — INGEST on `demo:notes` with content such as:

```
Customer Outreach Note — Carol White
Date: 2026-01-01
Status: Action Required

Carol is a premium customer (LTV: $92.49) with a high churn risk.
Pending order #5 (Wireless Mouse, $29.99) has not shipped since Dec 10.

Recommended actions:
1. Apologise for the delay and confirm shipping timeline.
2. Offer a discount on her next purchase.
3. Suggest related products: Mechanical Keyboard, Monitor Arm, Laptop Stand.
```

→ **SUCCESS**. The file is written to the notes directory and the hypervisor
returns `{"status": "SUCCESS", "affected": 1}`.

The contrast between steps 6a and 6b demonstrates ACCESS policy enforcement:
the same INGEST intent is denied on `demo:reports` but permitted on
`demo:notes`, without any user switching.

---

## Conclusion

This scenario demonstrated four key ADP capabilities through a realistic
customer churn investigation:

1. **Multi-backend data access** — PostgreSQL, MongoDB, pgvector, and local
   filesystem accessed through a single unified interface
2. **AI-orchestrated cross-system queries** — the AI client chained multiple
   ADP calls to build a complete customer picture without any server-side join
3. **Vector similarity search** — two-step embedding retrieval followed by a
   cosine similarity query for personalised product recommendations
4. **ACCESS policy enforcement** — role-based write control applied
   transparently at the hypervisor layer, blocking the restricted resource while
   permitting the writable one under the same user session
