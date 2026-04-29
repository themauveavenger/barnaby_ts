# YNAB Extension Design Spec

## Date: 2026-04-29

## Overview

Migrate the 7 YNAB tools from `mcp_for_ynab_ts` into barnaby as a `pi-coding-agent` extension. The extension lives at `src/plugins/agent/extensions/ynab.ts` and provides LLM-callable tools for transaction management, payee history analysis, and transaction lifecycle operations.

## Goals

- Port all 7 YNAB tools with TypeBox input schemas
- Maintain human-readable, agent-friendly output formatting (no JSON dumps)
- Keep all internal money math in `currency.js`, milliunit conversion only at API boundaries
- Follow barnaby's existing patterns (Fastify plugin for client, extension factory for tools)

## Architecture

### Files

| File | Purpose |
|------|---------|
| `src/plugins/ynab-client.ts` | Fastify plugin: initializes `ynab.API` from `YNAB_ACCESS_TOKEN`, decorates `fastify.ynabClient` |
| `src/plugins/agent/extensions/ynab-utils.ts` | Pure helper functions: name resolution, split validation, milliunit formatting, error handling, date utilities |
| `src/plugins/agent/extensions/ynab.ts` | Extension factory: registers all 7 tools via `pi.registerTool()` |
| `src/types/fastify.d.ts` | Add `ynabClient` to `FastifyInstance` declaration |
| `src/app.ts` | Register `ynabClientPlugin` before `agentPlugin` |
| `src/plugins/agent/index.ts` | Add `createYnabExtension(fastify)` to `extensionFactories` |

### Data Flow

```
Agent tool call
    -> ynab.ts extension execute()
    -> ynab-utils.ts helpers (resolve names, validate splits, format money)
    -> fastify.ynabClient.api (ynab.API)
    -> YNAB REST API
    -> Response formatting in plain English
    -> AgentToolResult { content: [{ type: "text", text: "..." }], details: {} }
```

## Tool Registration Pattern

Every tool is registered via `pi.registerTool()` with:
- `name`: snake_case tool identifier
- `label`: human-readable label for UI display
- `description`: LLM-facing explanation of what the tool does and when to use it
- `parameters`: `Type.Object({ ... })` where every property has a `description`
- `execute(_toolCallId, params)`: returns `Promise<AgentToolResult<unknown>>`

Organize output formatting into reusable helper functions (like `google-calendar.ts`'s `formatEvents()`, `formatCreateResponse()`, etc.) to keep `ynab.ts` readable.

---

## Tool Definitions

### 1. `ynab_get_transactions`

**Purpose**: Fetch transactions from a YNAB budget with optional filters.

**Registration**:
- `name`: `"ynab_get_transactions"`
- `label`: `"Get YNAB Transactions"`
- `description`: `"Fetches transactions from a YNAB budget. Use unapproved=true to find bank imports awaiting review. Use uncleared=true to find manual entries not yet matched."`

**Input Schema** (TypeBox):
- `budgetId`: `Type.String({ description: "The UUID of the YNAB budget" })`
- `sinceDate`: `Type.Optional(Type.String({ description: "Start date (YYYY-MM-DD). Defaults to 30 days ago." }))`
- `unapproved`: `Type.Optional(Type.Boolean({ description: "If true, return only unapproved transactions. If false, return only approved. Omit to include both." }))`
- `uncleared`: `Type.Optional(Type.Boolean({ description: "If true, return only uncleared transactions. If false, return only cleared/reconciled. Omit to include both." }))`

**Runtime Defaults**: `sinceDate` defaults to 30 days ago via `getDefaultSinceDate()`. These defaults are applied in `execute()`, not in the schema.

**Output Format**:
```
Returned 12 transactions from YNAB budget <budgetId> since 2026-03-30.
Unapproved filter: true | Uncleared filter: false

Transactions:
- 2026-04-15 | -$45.67 | Grocery Store | Food | Checking | uncleared | unapproved
- 2026-04-14 | $123.45 | Paycheck | Income | Savings | cleared | approved
...
```

Each transaction line: `- {date} | {amount_formatted} | {payee_name} | {category_name} | {account_name} | {cleared} | {approved/unapproved}`

Null values: render `payee_name` and `category_name` as `(none)` when null.

**Error Format**:
```
Error: Failed to fetch transactions from YNAB.
Budget "<budgetId>" not found. Verify the budget ID.
```

---

### 2. `ynab_get_payee_history`

**Purpose**: Fetch historical transactions for a payee and compute spending statistics to help decide auto-approval.

**Registration**:
- `name`: `"ynab_get_payee_history"`
- `label`: `"Get YNAB Payee History"`
- `description`: `"Fetches historical transactions for a payee and computes spending statistics (average, median, min/max, std deviation, frequency) to help decide whether a transaction should be auto-approved."`

**Input Schema**:
- `budgetId`: `Type.String({ description: "The UUID of the YNAB budget" })`
- `payeeName`: `Type.String({ description: "Exact payee name as it appears in YNAB" })`
- `sinceDate`: `Type.Optional(Type.String({ description: "Start date (YYYY-MM-DD). Defaults to 6 months ago." }))`
- `includeTransfers`: `Type.Optional(Type.Boolean({ description: "Whether to include transfer transactions. Defaults to false." }))`

**Runtime Defaults**: `sinceDate` defaults to 6 months ago. `includeTransfers` defaults to `false`. Applied in `execute()`.

**Amount Sign Convention**: All statistics are computed on **absolute values** of outflow amounts (`Math.abs(t.amount)`), so they display as positive dollar amounts. Outflows are negative in YNAB milliunits; we strip the sign for statistical comparison.

**Output Format**:
```
Payee history for "Grocery Store" over the last 180 days.
Transactions: 24 | Total spent: $1,234.56 | Refunds: 2
Average: $51.44 | Median: $48.50 | Min: $12.30 | Max: $187.90
Std deviation: $32.10 | Frequency: ~7.5 days between visits
Most common category: Food

Recent transactions:
- 2026-04-15 | -$45.67 | Food
- 2026-04-08 | -$52.10 | Food
- 2026-04-01 | -$38.99 | Food
```

**Error Format**:
```
Error: Payee "Grocery Store" not found in budget.
Check the exact spelling as it appears in YNAB.
```

---

### 3. `ynab_create_transaction`

**Purpose**: Create a new transaction (regular, transfer, or split).

**Registration**:
- `name`: `"ynab_create_transaction"`
- `label`: `"Create YNAB Transaction"`
- `description`: `"Creates a new transaction in YNAB. Supports regular transactions, transfers between accounts, and split transactions across multiple categories."`

**Input Schema**:
- `budgetId`: `Type.String({ description: "The UUID of the YNAB budget" })`
- `account`: `Type.String({ description: "Exact account name as it appears in YNAB" })`
- `payee`: `Type.Optional(Type.String({ description: "Exact payee name. Required unless transferToAccount is provided." }))`
- `transferToAccount`: `Type.Optional(Type.String({ description: "Exact name of target account for a transfer. Mutually exclusive with payee and splits." }))`
- `amount`: `Type.Number({ description: "Amount in dollars. Negative for outflow, positive for inflow." })`
- `date`: `Type.String({ description: "Transaction date (YYYY-MM-DD)" })`
- `category`: `Type.Optional(Type.String({ description: "Category name. Ignored for splits and transfers." }))`
- `memo`: `Type.Optional(Type.String({ description: "Optional memo/note" }))`
- `splits`: `Type.Optional(Type.Array(Type.Object({
    category: Type.String({ description: "Category name for this split" }),
    amount: Type.Union([Type.Number(), Type.Null()], { description: "Amount in dollars, or null to calculate from remainder" }),
    memo: Type.Optional(Type.String({ description: "Optional memo for this split" }))
  }), { description: "Splits to divide the transaction. Mutually exclusive with transferToAccount. At least 2 splits, at most one null amount." }))`

**Validation Errors**:
- Missing payee AND transferToAccount: `Error: Cannot create transaction. Either 'payee' or 'transferToAccount' must be provided.`
- Both transferToAccount AND splits provided: `Error: Cannot create transaction. Split transactions cannot be transfers. Provide either 'transferToAccount' or 'splits', not both.`
- Account/payee/category/target account not found: `Error: <Type> "<Name>" not found. Verify the exact name as it appears in YNAB.`
- Split validation failed: `Error: Invalid split amounts. <specific error>`
- Transfer account missing `transfer_payee_id`: `Error: Account "<Name>" does not support transfers.`

**Output Format** (regular):
```
Created transaction in Checking.
- Date: 2026-04-29 | Amount: -$45.67 | Payee: Grocery Store | Category: Food | Memo: Weekly groceries
```

**Output Format** (transfer):
```
Created transfer from Checking to Savings.
- Date: 2026-04-29 | Amount: -$500.00 | Transfer to Savings
```
Transfer payee display: derive from resolved target account name, format as `Transfer to <accountName>`.

**Output Format** (split):
```
Created split transaction in Checking across 3 categories.
- Date: 2026-04-29 | Amount: -$100.00 | Payee: Grocery Store
  - Food: -$60.00
  - Household: -$25.00
  - Personal: -$15.00
```

---

### 4. `ynab_split_transaction`

**Purpose**: Convert an existing transaction into a split across multiple categories.

**Registration**:
- `name`: `"ynab_split_transaction"`
- `label`: `"Split YNAB Transaction"`
- `description`: `"Converts an existing transaction into a split across multiple categories. The total of all splits must equal the original transaction amount. YNAB does not support re-splitting an already-split transaction."`

**Input Schema**:
- `budgetId`: `Type.String({ description: "The UUID of the YNAB budget" })`
- `transactionId`: `Type.String({ description: "The ID of the transaction to split" })`
- `splits`: `Type.Array(Type.Object({
    category: Type.String({ description: "Category name for this split" }),
    amount: Type.Union([Type.Number(), Type.Null()], { description: "Amount in dollars, or null to calculate from remainder" }),
    memo: Type.Optional(Type.String({ description: "Optional memo for this split" }))
  }), { minItems: 2, description: "At least 2 splits to divide the transaction" })`

**Proactive Guard**: Check `existingTransaction.subtransactions?.length > 0` before attempting the update. If already split, return the error immediately without calling the YNAB API.

**Output Format**:
```
Split transaction <transactionId> into 3 categories.
- Food: -$60.00
- Household: -$25.00
- Personal: -$15.00
```

**Error Format** (already split):
```
Error: Cannot split transaction <transactionId>.
This transaction is already split. Delete and recreate it to change splits.
```

---

### 5. `ynab_approve_transaction`

**Purpose**: Approve a transaction, optionally assigning a category, updating memo, or marking cleared. Idempotent.

**Registration**:
- `name`: `"ynab_approve_transaction"`
- `label`: `"Approve YNAB Transaction"`
- `description`: `"Approves a single YNAB transaction by ID. Optionally assigns a category, updates the memo, or marks the transaction as cleared. Re-approving an already-approved transaction succeeds with no changes."`

**Input Schema**:
- `budgetId`: `Type.String({ description: "The UUID of the YNAB budget" })`
- `transactionId`: `Type.String({ description: "The ID of the transaction to approve" })`
- `category`: `Type.Optional(Type.String({ description: "Category name to assign. Ignored if the transaction is already a split." }))`
- `memo`: `Type.Optional(Type.String({ description: "Memo/note to set on the transaction" }))`
- `cleared`: `Type.Optional(Type.Boolean({ description: "If true, marks the transaction as cleared. If false, marks it as uncleared. Omit to leave cleared status unchanged." }))`

**Output Format** (success):
```
Approved transaction <transactionId>.
- Date: 2026-04-29 | Amount: -$45.67 | Payee: Grocery Store | Category: Food | Cleared: yes
```

**Output Format** (already approved, no changes):
```
Transaction <transactionId> was already approved. No changes needed.
- Date: 2026-04-29 | Amount: -$45.67 | Payee: Grocery Store | Category: Food | Cleared: yes
```

**Error Format**:
```
Error: Transaction <transactionId> not found in budget.
```

**Error Format** (cannot category split):
```
Error: Cannot assign category to transaction <transactionId>.
This is a split transaction. Categories belong to subtransactions.
```

---

### 6. `ynab_delete_transaction`

**Purpose**: Delete a transaction by ID. Idempotent (404 treated as already deleted).

**Registration**:
- `name`: `"ynab_delete_transaction"`
- `label`: `"Delete YNAB Transaction"`
- `description`: `"Deletes a single YNAB transaction by ID. Use this when a bank import replaces a manual pre-entry. Deleting an already-deleted transaction returns a no-op success."`

**Input Schema**:
- `budgetId`: `Type.String({ description: "The UUID of the YNAB budget" })`
- `transactionId`: `Type.String({ description: "The ID of the transaction to delete" })`

**Output Format** (success):
```
Deleted transaction <transactionId>.
- Date: 2026-04-29 | Amount: -$45.67 | Payee: Grocery Store | Category: Food | Memo: Weekly groceries
```

**Output Format** (already deleted):
```
Transaction <transactionId> was already deleted or did not exist.
```

**Error Format**:
```
Error: Failed to delete transaction <transactionId>.
<YNAB API error message>
```

---

### 7. `ynab_flag_transaction`

**Purpose**: Set a flag color and/or prepend a reason template to the memo. Idempotent.

**Registration**:
- `name`: `"ynab_flag_transaction"`
- `label`: `"Flag YNAB Transaction"`
- `description`: `"Flags a YNAB transaction for human review by setting its flag color and optionally prepending a reason to the memo. Re-flagging with the same color returns a no-op success."`

**Input Schema**:
- `budgetId`: `Type.String({ description: "The UUID of the YNAB budget" })`
- `transactionId`: `Type.String({ description: "The ID of the transaction to flag" })`
- `flagColor`: `Type.Optional(Type.Enum({ red: "red", orange: "orange", yellow: "yellow", green: "green", blue: "blue", purple: "purple" }, { description: "Flag color to set. Required unless clearFlag is true." }))` — mutually exclusive with `clearFlag`
- `clearFlag`: `Type.Optional(Type.Boolean({ description: "When true, removes the flag color. Mutually exclusive with flagColor." }))` — mutually exclusive with `flagColor`
- `reason`: `Type.Optional(Type.Enum({ amount_anomaly: "amount_anomaly", new_payee: "new_payee", category_ambiguous: "category_ambiguous", possible_duplicate: "possible_duplicate", partial_match: "partial_match", manual_review: "manual_review" }, { description: "Reason for flagging. Prepends a template to the memo." }))` — optional, prepends template text to memo

**Validation Errors**:
- Neither `flagColor` nor `clearFlag` provided: `Error: Invalid flag input. Must provide either flagColor or clearFlag=true.`
- Both `flagColor` and `clearFlag` provided: `Error: Invalid flag input. Must provide either flagColor or clearFlag=true, but not both.`

**Output Format** (success):
```
Flagged transaction <transactionId> with red flag.
- Date: 2026-04-29 | Amount: -$45.67 | Payee: Grocery Store | Flag: red
- Memo: Amount outside expected range | Weekly groceries
```

**Output Format** (already flagged):
```
Transaction <transactionId> already has the red flag. No changes needed.
```

**Output Format** (clear):
```
Cleared flag from transaction <transactionId>.
- Date: 2026-04-29 | Amount: -$45.67 | Payee: Grocery Store | Flag: none
```

## Required Imports

```ts
import type { ExtensionAPI, ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type { FastifyInstance } from "fastify";
import { Type } from "typebox";
```

The `execute` signature is:
```ts
async execute(_toolCallId: string, params: Static<typeof ParametersSchema>) { ... }
```

## Fastify Plugin

`src/plugins/ynab-client.ts` must use `fp()` from `fastify-plugin` (like `calendar-client.ts`) to avoid encapsulation issues:

```ts
import fp from "fastify-plugin";
import * as ynab from "ynab";

export type YnabClient = { api: ynab.API };

export default fp(async function ynabClientPlugin(fastify: FastifyInstance) {
  const accessToken = process.env.YNAB_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error("YNAB_ACCESS_TOKEN environment variable is required");
  }
  const api = new ynab.API(accessToken);
  fastify.decorate("ynabClient", { api });
});
```

Add to `src/types/fastify.d.ts`:
```ts
import type { YnabClient } from "../plugins/ynab-client.js";

declare module "fastify" {
  interface FastifyInstance {
    // ... existing decorations ...
    ynabClient: YnabClient;
  }
}
```

**Token Handling**: If `YNAB_ACCESS_TOKEN` is missing, the plugin throws on startup. This is acceptable for a single-user project where YNAB is a required feature.

## Logging Strategy

Use `fastify.log` (Pino) for operational logging. Access it via the `fastify` instance passed to the extension factory. Log at `info` level for successful operations and `error` level for failures. Include context like `budgetId`, `transactionId`, and `payeeName` in log objects.

Example:
```ts
fastify.log.info({ budgetId, transactionId }, "Approving transaction");
```

## Formatting Helpers

Follow the `google-calendar.ts` pattern: export pure helper functions for formatting outputs. Examples:
- `formatTransactionLine(txn)` — single transaction line
- `formatTransactionsResponse(count, sinceDate, budgetId, transactions)` — full list response
- `formatCreateResponse(account, date, amount, payee, category, memo)` — create success
- `formatSplitResponse(transactionId, splits)` — split success
- `formatApprovalResponse(transaction, wasAlreadyApproved)` — approval result
- `formatFlagResponse(transaction, wasAlreadyFlagged)` — flag result
- `formatErrorResponse(summary, detail?)` — consistent error text

Keep these in `ynab.ts` (co-located with tool registration) or in `ynab-utils.ts` if they are pure and shared.

## AgentToolResult Details

The pi SDK requires `content: (TextContent | ImageContent)[]` but `details` is optional. Include `details: {}` explicitly on every return for consistency.

## Money Handling Rules

- Input amounts arrive as `number` (dollars)
- Immediately wrap with `currency()` for all internal math
- Convert to milliunits **only** at the YNAB API boundary: `Math.round(amount.value * 1000)`
- Format milliunits for display: `currency(milliunits / 1000).format()`
- `mathjs` (`median`, `std`, `mean`, `sum`, `min`, `max`) used **only** in `ynab_get_payee_history`

## Error Handling Rules

- Never throw raw errors into the pi SDK (that creates opaque error states)
- Never return `JSON.stringify` dumps
- Catch all errors and format them as plain English text:
  - Line 1: `Error: <short human-readable summary>`
  - Subsequent lines: actionable detail or YNAB API message
- Distinguish domain errors (name not found, validation failed) from YNAB API errors (401, 404, 429, 500, 503)
- Use idempotent semantics where the original tools did: already-approved, already-deleted, already-flagged

## Dependencies

Install with `npm --save-exact`:
- `ynab` — official YNAB SDK
- `currency.js` — precise money math
- `mathjs` — statistical functions for payee history
- `date-fns` — date math for payee history (subMonths, differenceInDays, parseISO)

**mathjs Import**: Import only the named functions needed (`median`, `std`, `mean`, `sum`, `min`, `max`) from the main `mathjs` package. If bundle size becomes a concern, consider `mathjs/number` as a lighter alternative.

## TypeScript Conventions

- Use `import type` / `export type` for type-only imports (`verbatimModuleSyntax`)
- All function signatures have explicit return types
- No `enum`, `namespace`, or parameter properties (`erasableSyntaxOnly`)
- Do not reimplement types from the `ynab` package; import them

## Testing

- End-to-end tests using Fastify's `inject()` with vitest (per AGENTS.md)
- Test file location: `test/plugins/agent/extensions/ynab.test.ts`
- Mock `ynab.API` by passing a mock object into the extension factory or by mocking the plugin
- Test coverage:
  - Tool registration: verify all 7 tools are registered with correct names
  - `ynab_get_transactions`: filtering by unapproved/uncleared, default since date, output formatting
  - `ynab_get_payee_history`: payee resolution, statistics calculation, transfer exclusion
  - `ynab_create_transaction`: regular, transfer, and split modes, validation errors
  - `ynab_split_transaction`: split validation, already-split guard
  - `ynab_approve_transaction`: idempotency, category assignment, cleared toggle
  - `ynab_delete_transaction`: idempotency (404 = already deleted)
  - `ynab_flag_transaction`: flag/clear mutual exclusion, idempotency, reason memo prepending
  - Name resolution: account, category, payee resolution from mocked API responses
  - Money formatting: milliunit to currency formatting, currency math accuracy
  - Error formatting: all error paths return plain English text, not JSON dumps
- To capture registered tools from the `ExtensionFactory` callback, create a mock `ExtensionAPI` with a `registerTool` spy
- Assert on the `content[0].text` of returned `AgentToolResult` objects

## Out of Scope

- MCP server wrapping (this is a native pi extension, not an MCP server)
- Output schemas (pi-coding-agent does not support them)
- Zod schemas (replaced with TypeBox)
- OAuth or token refresh (reads static `YNAB_ACCESS_TOKEN` env var)
- Multi-budget workflows beyond passing `budgetId` per call
