# YNAB Extension Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate 7 YNAB tools from `mcp_for_ynab_ts` into barnaby as a `pi-coding-agent` extension with TypeBox schemas, currency.js money math, and human-readable output formatting.

**Architecture:** Fastify plugin initializes the `ynab.API` client. Extension factory registers 7 tools. Pure helper functions live in `ynab-utils.ts`. All money math uses `currency.js` internally; milliunit conversion only at YNAB API boundaries.

**Tech Stack:** TypeScript, TypeBox, Fastify, `ynab` SDK, `currency.js`, `mathjs`, `date-fns`, vitest

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `src/plugins/ynab-client.ts` | Create | Fastify plugin: reads `YNAB_ACCESS_TOKEN`, decorates `fastify.ynabClient` with `ynab.API` |
| `src/types/fastify.d.ts` | Modify | Add `ynabClient: YnabClient` to `FastifyInstance` |
| `src/app.ts` | Modify | Register `ynabClientPlugin` before `agentPlugin` |
| `src/plugins/agent/extensions/ynab-utils.ts` | Create | Pure helpers: `resolveAccountId`, `resolveCategoryId`, `resolvePayeeId`, `validateAndResolveSplits`, `formatMilliunits`, `getDefaultSinceDate`, `getDefaultPayeeSinceDate`, `daysBetween`, `calculateFrequencyDays`, `mostCommonCategory`, `buildPayeeStats` |
| `src/plugins/agent/extensions/ynab.ts` | Rewrite | Extension factory: registers all 7 tools with TypeBox schemas and execute handlers |
| `src/plugins/agent/index.ts` | Modify | Add `createYnabExtension(fastify)` to `extensionFactories` |
| `test/plugins/agent/extensions/ynab.test.ts` | Create | End-to-end tests for tool registration, formatting, validation, error handling |

---

## Task 1: Install Dependencies

**Files:** `package.json`

- [ ] **Step 1: Install new packages**

```bash
npm install --save-exact ynab currency.js mathjs date-fns
```

- [ ] **Step 2: Verify package.json updates**

Check that `ynab`, `currency.js`, `mathjs`, and `date-fns` appear in `dependencies` with exact versions.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
npm run typecheck
npm test
git commit -m "chore(deps): add ynab, currency.js, mathjs, date-fns"
```

---

## Task 2: Create YNAB Client Plugin

**Files:**
- Create: `src/plugins/ynab-client.ts`
- Modify: `src/types/fastify.d.ts`
- Modify: `src/app.ts`

- [ ] **Step 1: Write `src/plugins/ynab-client.ts`**

```ts
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import * as ynab from "ynab";

export type YnabClient = {
  api: ynab.API;
};

export default fp(async function ynabClientPlugin(fastify: FastifyInstance): Promise<void> {
  const accessToken = process.env.YNAB_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error("YNAB_ACCESS_TOKEN environment variable is required");
  }
  const api = new ynab.API(accessToken);
  fastify.decorate("ynabClient", { api });
});
```

- [ ] **Step 2: Update `src/types/fastify.d.ts`**

Add the import and the decoration. The existing file should gain:

```ts
import type { YnabClient } from "../plugins/ynab-client.js";
```

And inside the `FastifyInstance` interface:

```ts
ynabClient: YnabClient;
```

- [ ] **Step 3: Register plugin in `src/app.ts`**

Add `import ynabClientPlugin from "./plugins/ynab-client.js";` near the other plugin imports, then register it before `agentPlugin`:

```ts
await app.register(ynabClientPlugin);
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS (no errors)

- [ ] **Step 5: Commit**

```bash
git add src/plugins/ynab-client.ts src/types/fastify.d.ts src/app.ts
git commit -m "feat(ynab): add YNAB client Fastify plugin"
```

---

## Task 3: Create `ynab-utils.ts` Helpers

**Files:**
- Create: `src/plugins/agent/extensions/ynab-utils.ts`

- [ ] **Step 1: Write the full `ynab-utils.ts` file**

```ts
import * as ynab from "ynab";
import currency from "currency.js";
import { subMonths, differenceInDays, parseISO } from "date-fns";
import { median, std, mean, sum, min, max } from "mathjs";

// ---------------------------------------------------------------------------
// Name resolvers
// ---------------------------------------------------------------------------

export async function resolveAccountId(
  ynabAPI: ynab.API,
  budgetId: string,
  name: string
): Promise<string | null> {
  const response = await ynabAPI.accounts.getAccounts(budgetId);
  const accounts = response.data.accounts;
  const match = accounts.find((a) => !a.deleted && !a.closed && a.name === name);
  return match?.id ?? null;
}

export async function resolveCategoryId(
  ynabAPI: ynab.API,
  budgetId: string,
  name: string
): Promise<string | null> {
  const response = await ynabAPI.categories.getCategories(budgetId);
  const categories = response.data.category_groups.flatMap((g) => g.categories);
  const match = categories.find((c) => !c.deleted && !c.hidden && c.name === name);
  return match?.id ?? null;
}

export async function resolvePayeeId(
  ynabAPI: ynab.API,
  budgetId: string,
  name: string
): Promise<string | null> {
  const response = await ynabAPI.payees.getPayees(budgetId);
  const payees = response.data.payees;
  const match = payees.find((p) => !p.deleted && p.name === name);
  return match?.id ?? null;
}

// ---------------------------------------------------------------------------
// Split validation
// ---------------------------------------------------------------------------

export interface SplitInput {
  category: string;
  amount: currency | null;
  memo?: string;
}

export interface ValidateSplitsResult {
  subtransactions: ynab.SaveSubTransaction[];
  errors: string[];
}

export async function validateAndResolveSplits(
  ynabAPI: ynab.API,
  budgetId: string,
  totalAmount: currency,
  splits: SplitInput[]
): Promise<ValidateSplitsResult> {
  const errors: string[] = [];

  if (splits.length < 2) {
    errors.push("A split transaction requires at least 2 splits.");
    return { subtransactions: [], errors };
  }

  const nullCount = splits.filter((s) => s.amount === null).length;
  if (nullCount > 1) {
    errors.push("Only one split may have a null amount (calculated from remainder).");
  }

  const resolvedCategories: Array<{ id: string; name: string } | null> = [];
  for (const split of splits) {
    const id = await resolveCategoryId(ynabAPI, budgetId, split.category);
    if (!id) {
      errors.push(`Category "${split.category}" not found.`);
      resolvedCategories.push(null);
    } else {
      resolvedCategories.push({ id, name: split.category });
    }
  }

  if (errors.length > 0) {
    return { subtransactions: [], errors };
  }

  let explicitSum = currency(0);
  for (const split of splits) {
    if (split.amount !== null) {
      explicitSum = explicitSum.add(split.amount);
    }
  }

  const remainder = totalAmount.subtract(explicitSum);

  if (nullCount === 0) {
    if (explicitSum.value !== totalAmount.value) {
      errors.push(
        `Split amounts sum to ${formatAmount(explicitSum)} but total is ${formatAmount(totalAmount)}.`
      );
    }
  } else if (nullCount === 1) {
    if (remainder.value === 0) {
      errors.push(
        "The calculated remainder is 0. Please provide explicit amounts for all splits."
      );
    }
  }

  if (errors.length > 0) {
    return { subtransactions: [], errors };
  }

  const subtransactions: ynab.SaveSubTransaction[] = [];
  for (let i = 0; i < splits.length; i++) {
    const split = splits[i];
    const category = resolvedCategories[i]!;
    const amountDollars = split.amount === null ? remainder : split.amount;
    const amountMilliunits = Math.round(amountDollars.value * 1000);

    subtransactions.push({
      amount: amountMilliunits,
      category_id: category.id,
      memo: split.memo ?? null,
    });
  }

  return { subtransactions, errors };
}

// ---------------------------------------------------------------------------
// Money formatting
// ---------------------------------------------------------------------------

export function formatMilliunits(milliunits: number): string {
  return currency(milliunits / 1000).format();
}

export function formatAmount(c: currency): string {
  const value = c.value;
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return `${sign}$${abs.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Date utilities
// ---------------------------------------------------------------------------

export function getDefaultSinceDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return date.toISOString().split("T")[0];
}

export function getDefaultPayeeSinceDate(): string {
  return subMonths(new Date(), 6).toISOString().split("T")[0];
}

export function daysBetween(a: string, b: string): number {
  return differenceInDays(parseISO(b), parseISO(a));
}

export function calculateFrequencyDays(dates: string[]): number | null {
  if (dates.length <= 1) return null;
  const sorted = [...dates].sort();
  let totalGap = 0;
  for (let i = 1; i < sorted.length; i++) {
    totalGap += daysBetween(sorted[i - 1], sorted[i]);
  }
  return totalGap / (sorted.length - 1);
}

// ---------------------------------------------------------------------------
// Payee history statistics
// ---------------------------------------------------------------------------

export function mostCommonCategory(categories: (string | null | undefined)[]): string | null {
  const counts = new Map<string, number>();
  for (const cat of categories) {
    if (!cat) continue;
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [cat, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = cat;
    }
  }
  return best;
}

export interface PayeeStats {
  transactionCount: number;
  totalSpent: number;
  averageAmount: number;
  medianAmount: number;
  minAmount: number;
  maxAmount: number;
  stdDeviation: number;
  firstTransactionDate: string;
  lastTransactionDate: string;
  frequencyDays: number | null;
  mostCommonCategory: string | null;
  refundCount: number;
  recentTransactions: Array<{ date: string; amount: number; category_name: string | null }>;
}

export function buildPayeeStats(
  transactions: ynab.HybridTransaction[]
): PayeeStats {
  const outflows = transactions.filter((t) => t.amount < 0);
  const inflows = transactions.filter((t) => t.amount > 0);

  const outflowAmounts = outflows.map((t) => Math.abs(t.amount));
  const outflowDates = outflows.map((t) => t.date);

  const sortedByDate = [...outflows].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const transactionCount = outflows.length;
  const totalSpent = sum(outflowAmounts) as number;
  const averageAmount = transactionCount > 0 ? (mean(outflowAmounts) as number) : 0;
  const medianAmount = outflowAmounts.length > 0 ? (median(outflowAmounts) as number) : 0;
  const minAmount = transactionCount > 0 ? (min(outflowAmounts) as number) : 0;
  const maxAmount = transactionCount > 0 ? (max(outflowAmounts) as number) : 0;
  const stdDeviation =
    outflowAmounts.length > 1 ? (std(outflowAmounts, "uncorrected") as number) : 0;

  const allDates = [...outflowDates, ...inflows.map((t) => t.date)].sort();
  const firstTransactionDate = allDates[0] ?? "";
  const lastTransactionDate = allDates[allDates.length - 1] ?? "";

  const frequencyDays = calculateFrequencyDays(outflowDates);
  const category = mostCommonCategory(outflows.map((t) => t.category_name));

  const recentTransactions = sortedByDate.slice(0, 3).map((t) => ({
    date: t.date,
    amount: t.amount,
    category_name: t.category_name ?? null,
  }));

  return {
    transactionCount,
    totalSpent,
    averageAmount,
    medianAmount,
    minAmount,
    maxAmount,
    stdDeviation,
    firstTransactionDate,
    lastTransactionDate,
    frequencyDays,
    mostCommonCategory: category,
    refundCount: inflows.length,
    recentTransactions,
  };
}

// ---------------------------------------------------------------------------
// YNAB error helpers
// ---------------------------------------------------------------------------

const YNAB_ERROR_MESSAGES: Record<string, string> = {
  "401": "Unauthorized: Invalid or expired access token",
  "404": "Budget not found: Verify the budget ID",
  "429": "Rate limit exceeded: YNAB allows 200 requests per hour. Please wait and try again.",
  "500": "YNAB service error: Please try again later",
  "503": "YNAB service unavailable: Temporary outage, please try again later",
};

export function getYnabErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "error" in error) {
    const ynabError = (error as { error: { id: string; name: string; detail: string } }).error;
    return (
      YNAB_ERROR_MESSAGES[ynabError.id] ||
      `YNAB API Error (${ynabError.id}): ${ynabError.detail}`
    );
  }
  throw error;
}

export function isYnabNotFoundError(error: unknown): boolean {
  return (
    error !== null &&
    error !== undefined &&
    typeof error === "object" &&
    "error" in error &&
    typeof (error as { error: { id: string } }).error.id === "string" &&
    (error as { error: { id: string } }).error.id === "404"
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/plugins/agent/extensions/ynab-utils.ts
git commit -m "feat(ynab): add YNAB utility helpers"
```

---

## Task 4: Implement `ynab.ts` Extension (Part 1 — get_transactions + get_payee_history)

**Files:**
- Rewrite: `src/plugins/agent/extensions/ynab.ts`

- [ ] **Step 1: Write the extension factory with first two tools**

The file should import from `ynab-utils.ts` and register `ynab_get_transactions` and `ynab_get_payee_history`.

Key points:
- `createYnabExtension(fastify: FastifyInstance): ExtensionFactory`
- Both tools use `fastify.ynabClient.api`
- `ynab_get_transactions`: default `sinceDate` to `getDefaultSinceDate()`, filter by `unapproved`/`uncleared`, format transactions as plain text lines
- `ynab_get_payee_history`: resolve payee by name, fetch by payee ID, compute stats via `buildPayeeStats`, format as plain text
- All errors are caught and returned as `AgentToolResult` with `content: [{ type: "text", text: "Error: ..." }]`

Example return shape for success:
```ts
return {
  content: [{ type: "text" as const, text: lines.join("\n") }],
  details: {},
};
```

- [ ] **Step 2: Update `src/plugins/agent/index.ts`**

Add:
```ts
import createYnabExtension from "./extensions/ynab.js";
```

And append `createYnabExtension(fastify)` to the `extensionFactories` array.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/plugins/agent/extensions/ynab.ts src/plugins/agent/index.ts
git commit -m "feat(ynab): add get_transactions and get_payee_history tools"
```

---

## Task 5: Implement `ynab.ts` Extension (Part 2 — create_transaction + split_transaction)

**Files:**
- Modify: `src/plugins/agent/extensions/ynab.ts`

- [ ] **Step 1: Add `ynab_create_transaction` tool**

Input schema (TypeBox):
```ts
Type.Object({
  budgetId: Type.String({ description: "The UUID of the YNAB budget" }),
  account: Type.String({ description: "Exact account name as it appears in YNAB" }),
  payee: Type.Optional(Type.String({ description: "Exact payee name. Required unless transferToAccount is provided." })),
  transferToAccount: Type.Optional(Type.String({ description: "Exact name of target account for a transfer. Mutually exclusive with payee and splits." })),
  amount: Type.Number({ description: "Amount in dollars. Negative for outflow, positive for inflow." }),
  date: Type.String({ description: "Transaction date (YYYY-MM-DD)" }),
  category: Type.Optional(Type.String({ description: "Category name. Ignored for splits and transfers." })),
  memo: Type.Optional(Type.String({ description: "Optional memo/note" })),
  splits: Type.Optional(Type.Array(
    Type.Object({
      category: Type.String({ description: "Category name for this split" }),
      amount: Type.Union([Type.Number(), Type.Null()], { description: "Amount in dollars, or null to calculate from remainder" }),
      memo: Type.Optional(Type.String({ description: "Optional memo for this split" })),
    }),
    { description: "Splits to divide the transaction. Mutually exclusive with transferToAccount. At least 2 splits, at most one null amount." }
  )),
})
```

Validation in `execute()`:
1. If `!payee && !transferToAccount` → return error text
2. If `transferToAccount && splits` → return error text
3. Resolve account ID; if null → return error text
4. If transfer: resolve target account, get `transfer_payee_id`, create transfer
5. If regular: resolve payee ID; if null → return error text
6. If splits: call `validateAndResolveSplits` with `currency(params.amount)`; if errors → return error text
7. If category: resolve category ID; if null → return error text
8. Convert amount to milliunits: `Math.round(currency(params.amount).value * 1000)`
9. Call `ynabAPI.transactions.createTransaction`
10. Format success response as plain English text

- [ ] **Step 2: Add `ynab_split_transaction` tool**

Input schema (TypeBox):
```ts
Type.Object({
  budgetId: Type.String({ description: "The UUID of the YNAB budget" }),
  transactionId: Type.String({ description: "The ID of the transaction to split" }),
  splits: Type.Array(
    Type.Object({
      category: Type.String({ description: "Category name for this split" }),
      amount: Type.Union([Type.Number(), Type.Null()], { description: "Amount in dollars, or null to calculate from remainder" }),
      memo: Type.Optional(Type.String({ description: "Optional memo for this split" })),
    }),
    { minItems: 2, description: "At least 2 splits to divide the transaction" }
  ),
})
```

Execution flow:
1. Fetch existing transaction via `getTransactionById`
2. Proactively check `existingTransaction.subtransactions?.length > 0`; if true → return "already split" error
3. Compute `totalAmount = currency(existingTransaction.amount / 1000)`
4. Call `validateAndResolveSplits`
5. Build update payload with `category_id: undefined` and `subtransactions`
6. Call `updateTransactions`
7. Format success as plain English text

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/plugins/agent/extensions/ynab.ts
git commit -m "feat(ynab): add create_transaction and split_transaction tools"
```

---

## Task 6: Implement `ynab.ts` Extension (Part 3 — approve + delete + flag)

**Files:**
- Modify: `src/plugins/agent/extensions/ynab.ts`

- [ ] **Step 1: Add `ynab_approve_transaction` tool**

Input schema (TypeBox):
```ts
Type.Object({
  budgetId: Type.String({ description: "The UUID of the YNAB budget" }),
  transactionId: Type.String({ description: "The ID of the transaction to approve" }),
  category: Type.Optional(Type.String({ description: "Category name to assign. Ignored if the transaction is already a split." })),
  memo: Type.Optional(Type.String({ description: "Memo/note to set on the transaction" })),
  cleared: Type.Optional(Type.Boolean({ description: "If true, marks as cleared. If false, marks as uncleared. Omit to leave unchanged." })),
})
```

Execution flow:
1. Pre-fetch transaction. If 404 → return "not found" error text
2. Check `wasAlreadyApproved`
3. If category provided and `subtransactions?.length > 0` → return "cannot category split" error
4. Resolve category ID if provided; if null → return "category not found" error
5. Build update payload with `approved: true`, optional `category_id`, `memo`, `cleared`
6. If already approved and no meaningful changes → return no-op success text
7. Call `updateTransactions`
8. Re-fetch final state
9. Format success as plain English text

- [ ] **Step 2: Add `ynab_delete_transaction` tool**

Input schema (TypeBox):
```ts
Type.Object({
  budgetId: Type.String({ description: "The UUID of the YNAB budget" }),
  transactionId: Type.String({ description: "The ID of the transaction to delete" }),
})
```

Execution flow:
1. Pre-fetch transaction. If 404 → return "already deleted or did not exist" text
2. Call `deleteTransaction`
3. Format success as plain English text with captured transaction details

- [ ] **Step 3: Add `ynab_flag_transaction` tool**

Input schema (TypeBox):
```ts
Type.Object({
  budgetId: Type.String({ description: "The UUID of the YNAB budget" }),
  transactionId: Type.String({ description: "The ID of the transaction to flag" }),
  flagColor: Type.Optional(Type.Enum({ red: "red", orange: "orange", yellow: "yellow", green: "green", blue: "blue", purple: "purple" }, { description: "Flag color to set. Required unless clearFlag is true." })),
  clearFlag: Type.Optional(Type.Boolean({ description: "When true, removes the flag color. Mutually exclusive with flagColor." })),
  reason: Type.Optional(Type.Enum({ amount_anomaly: "amount_anomaly", new_payee: "new_payee", category_ambiguous: "category_ambiguous", possible_duplicate: "possible_duplicate", partial_match: "partial_match", manual_review: "manual_review" }, { description: "Reason for flagging. Prepends a template to the memo." })),
})
```

Validation in `execute()`:
1. If `!flagColor && !clearFlag` → return error
2. If `flagColor && clearFlag` → return error

Execution flow:
1. Fetch transaction. If 404 → return "not found" error
2. Compute `targetFlagColor = clearFlag ? "" : flagColor!`
3. Compute new memo by prepending reason template if provided
4. Check idempotency: if flag and memo already match → return no-op text
5. Build update payload with `flag_color` and optional `memo`
6. Call `updateTransactions`
7. Re-fetch final state
8. Format success as plain English text

Flag reason templates (same as source):
```ts
const FLAG_REASON_TEMPLATES: Record<string, string> = {
  amount_anomaly: "Amount outside expected range",
  new_payee: "No payee history available",
  category_ambiguous: "No clear category match",
  possible_duplicate: "Possible duplicate transaction",
  partial_match: "Partial match to pre-entry",
  manual_review: "Needs manual review",
};
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/agent/extensions/ynab.ts
git commit -m "feat(ynab): add approve, delete, and flag transaction tools"
```

---

## Task 7: End-to-End Tests

**Files:**
- Create: `test/plugins/agent/extensions/ynab.test.ts`

- [ ] **Step 1: Write tests for `ynab_get_transactions`**

Mock `ynab.API` responses. Test:
- Default since date (30 days ago)
- Unapproved filter
- Uncleared filter
- Output formatting lines
- Error formatting when API throws 404

- [ ] **Step 2: Write tests for `ynab_create_transaction`**

Test:
- Regular transaction creation
- Transfer creation
- Split creation with null remainder
- Validation error: missing payee/transfer
- Validation error: transfer + splits
- Name not found error formatting

- [ ] **Step 3: Write tests for `ynab_split_transaction`**

Test:
- Successful split
- Already-split guard
- Split validation error

- [ ] **Step 4: Write tests for `ynab_approve_transaction`**

Test:
- Approve with category and cleared
- Idempotent already-approved
- Cannot-category-split error

- [ ] **Step 5: Write tests for `ynab_delete_transaction`**

Test:
- Successful delete
- Already-deleted (404) handling

- [ ] **Step 6: Write tests for `ynab_flag_transaction`**

Test:
- Flag with color and reason
- Clear flag
- Idempotent already-flagged
- Validation: neither flagColor nor clearFlag
- Validation: both provided

- [ ] **Step 7: Write tests for `ynab_get_payee_history`**

Test:
- Statistics calculation
- Transfer exclusion
- Payee not found error

- [ ] **Step 8: Write tests for utility helpers**

Test:
- `formatMilliunits` / `formatAmount`
- `validateAndResolveSplits` (various cases)
- `buildPayeeStats` (mean, median, std dev, frequency)

- [ ] **Step 9: Run all tests**

```bash
npm test
```

Expected: All new tests PASS

- [ ] **Step 10: Commit**

```bash
git add test/plugins/agent/extensions/ynab.test.ts
git commit -m "test(ynab): add e2e tests for YNAB extension tools"
```

---

## Task 8: Final Verification

- [ ] **Step 1: Run full typecheck**

```bash
npm run typecheck
```

Expected: PASS

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: All tests PASS

- [ ] **Step 3: Review `git diff`**

```bash
git diff --stat HEAD~8
```

Verify all expected files were created/modified and no unintended changes.

- [ ] **Step 4: Final commit (if any lingering changes)**

If any fixes were needed during verification, commit them.

---

## Self-Review Checklist

1. **Spec coverage**: Every tool from the spec is implemented in a task? ✅ (Tasks 4–6 cover all 7 tools)
2. **Placeholder scan**: No "TBD", "TODO", "implement later", "similar to Task N"? ✅
3. **Type consistency**: `YnabClient`, `ExtensionFactory`, `AgentToolResult` types used consistently? ✅
4. **Money rules**: `currency.js` internal, milliunits only at API boundary? ✅ (validated in `validateAndResolveSplits`, tool execute handlers)
5. **Error formatting**: All errors return plain English text, not JSON dumps? ✅
6. **Testing**: E2E tests for all tools and utilities? ✅ (Task 7)
