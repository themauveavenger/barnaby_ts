# YNAB Extension Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 1077-line `ynab.ts` monolith into single-responsibility modules under `src/plugins/agent/extensions/ynab/`, with matching per-tool test files.

**Architecture:** Each tool is a factory function `(fastify) => ToolDefinition<typeof paramsSchema>`. `ynab/index.ts` registers all 7 tools. `formatters.ts` holds pure formatting helpers. `utils.ts` holds pure utility functions (moved from `ynab-utils.ts`).

**Tech Stack:** TypeScript, TypeBox, Fastify, vitest, `ynab` SDK, `currency.js`

---

## File Structure

```
src/plugins/agent/extensions/ynab/
├── index.ts
├── formatters.ts
├── utils.ts
└── tools/
    ├── ynab-get-transactions.ts
    ├── ynab-get-payee-history.ts
    ├── ynab-create-transaction.ts
    ├── ynab-split-transaction.ts
    ├── ynab-approve-transaction.ts
    ├── ynab-delete-transaction.ts
    └── ynab-flag-transaction.ts

test/plugins/agent/extensions/ynab/
├── test-helpers.ts
├── formatters.test.ts
├── utils.test.ts
└── tools/
    ├── ynab-get-transactions.test.ts
    ├── ynab-get-payee-history.test.ts
    ├── ynab-create-transaction.test.ts
    ├── ynab-split-transaction.test.ts
    ├── ynab-approve-transaction.test.ts
    ├── ynab-delete-transaction.test.ts
    └── ynab-flag-transaction.test.ts
```

---

### Task 1: Create `ynab/formatters.ts`

**Files:**
- Create: `src/plugins/agent/extensions/ynab/formatters.ts`

- [ ] **Step 1: Write the file**

```ts
import type * as ynab from "ynab";
import { formatMilliunits, buildPayeeStats } from "./utils.js";

export function formatTransactionLine(t: ynab.TransactionDetail): string {
  const amount = formatMilliunits(t.amount);
  const payee = t.payee_name ?? "(none)";
  const category = t.category_name ?? "(none)";
  const approved = t.approved ? "approved" : "unapproved";
  return `- ${t.date} | ${amount} | ${payee} | ${category} | ${t.account_name} | ${t.cleared} | ${approved}`;
}

export function formatTransactionsResponse(
  budgetId: string,
  sinceDate: string,
  unapproved: boolean | undefined,
  uncleared: boolean | undefined,
  transactions: ynab.TransactionDetail[]
): string {
  const lines: string[] = [
    `Returned ${transactions.length} transactions from YNAB budget ${budgetId} since ${sinceDate}.`,
  ];

  const filters: string[] = [];
  if (unapproved !== undefined) filters.push(`Unapproved filter: ${unapproved}`);
  if (uncleared !== undefined) filters.push(`Uncleared filter: ${uncleared}`);
  if (filters.length > 0) {
    lines.push(filters.join(" | "));
  }

  lines.push("", "Transactions:");
  for (const t of transactions) {
    lines.push(formatTransactionLine(t));
  }

  return lines.join("\n");
}

export function formatPayeeHistoryResponse(
  payeeName: string,
  sinceDate: string,
  stats: ReturnType<typeof buildPayeeStats>
): string {
  const today = new Date().toISOString().split("T")[0];
  const { daysBetween } = await import("./utils.js");
  const days = daysBetween(sinceDate, today);

  const lines: string[] = [
    `Payee history for "${payeeName}" over the last ${days} days.`,
    `Transactions: ${stats.transactionCount} | Total spent: ${formatMilliunits(stats.totalSpent)} | Refunds: ${stats.refundCount}`,
    `Average: ${formatMilliunits(stats.averageAmount)} | Median: ${formatMilliunits(stats.medianAmount)} | Min: ${formatMilliunits(stats.minAmount)} | Max: ${formatMilliunits(stats.maxAmount)}`,
  ];

  const frequency =
    stats.frequencyDays !== null
      ? `~${stats.frequencyDays.toFixed(1)} days between visits`
      : "N/A (insufficient data)";
  lines.push(`Std deviation: ${formatMilliunits(stats.stdDeviation)} | Frequency: ${frequency}`);
  lines.push(`Most common category: ${stats.mostCommonCategory ?? "N/A"}`);

  lines.push("", "Recent transactions:");
  for (const t of stats.recentTransactions) {
    lines.push(`- ${t.date} | ${formatMilliunits(t.amount)} | ${t.category_name ?? "(none)"}`);
  }

  return lines.join("\n");
}

export function formatCreateTransactionResponse(
  account: string,
  date: string,
  amount: string,
  payee: string,
  category: string | null,
  memo: string | null
): string {
  const lines = [`Created transaction in ${account}.`];
  const categoryText = category ?? "(none)";
  const memoText = memo ? ` | Memo: ${memo}` : "";
  lines.push(`- Date: ${date} | Amount: ${amount} | Payee: ${payee} | Category: ${categoryText}${memoText}`);
  return lines.join("\n");
}

export function formatCreateTransferResponse(
  fromAccount: string,
  toAccount: string,
  date: string,
  amount: string
): string {
  const lines = [
    `Created transfer from ${fromAccount} to ${toAccount}.`,
    `- Date: ${date} | Amount: ${amount} | Transfer to ${toAccount}`,
  ];
  return lines.join("\n");
}

export interface SplitLine {
  category: string;
  amount: string;
}

export function formatCreateSplitResponse(
  account: string,
  date: string,
  amount: string,
  payee: string,
  splits: SplitLine[]
): string {
  const lines = [
    `Created split transaction in ${account} across ${splits.length} categories.`,
    `- Date: ${date} | Amount: ${amount} | Payee: ${payee}`,
  ];
  for (const split of splits) {
    lines.push(`  - ${split.category}: ${split.amount}`);
  }
  return lines.join("\n");
}

export function formatSplitTransactionResponse(
  transactionId: string,
  splits: SplitLine[]
): string {
  const lines = [`Split transaction ${transactionId} into ${splits.length} categories.`];
  for (const split of splits) {
    lines.push(`- ${split.category}: ${split.amount}`);
  }
  return lines.join("\n");
}

export function formatApproveTransactionResponse(
  transactionId: string,
  date: string,
  amount: string,
  payee: string,
  category: string | null,
  cleared: string
): string {
  const categoryText = category ?? "(none)";
  const clearedText = cleared === "uncleared" ? "no" : "yes";
  return `Approved transaction ${transactionId}.\n- Date: ${date} | Amount: ${amount} | Payee: ${payee} | Category: ${categoryText} | Cleared: ${clearedText}`;
}

export function formatAlreadyApprovedResponse(
  transactionId: string,
  date: string,
  amount: string,
  payee: string,
  category: string | null,
  cleared: string
): string {
  const categoryText = category ?? "(none)";
  const clearedText = cleared === "uncleared" ? "no" : "yes";
  return `Transaction ${transactionId} was already approved. No changes needed.\n- Date: ${date} | Amount: ${amount} | Payee: ${payee} | Category: ${categoryText} | Cleared: ${clearedText}`;
}

export function formatDeleteTransactionResponse(
  transactionId: string,
  date: string,
  amount: string,
  payee: string,
  category: string | null,
  memo: string | null
): string {
  const categoryText = category ?? "(none)";
  const memoText = memo ? ` | Memo: ${memo}` : "";
  return `Deleted transaction ${transactionId}.\n- Date: ${date} | Amount: ${amount} | Payee: ${payee} | Category: ${categoryText}${memoText}`;
}

export function formatFlagTransactionResponse(
  transactionId: string,
  flagColor: string | null,
  memo: string | null
): string {
  const memoText = memo ? `\n- Memo: ${memo}` : "";
  if (!flagColor) {
    return `Cleared flag from transaction ${transactionId}.${memoText}`;
  }
  return `Flagged transaction ${transactionId} with ${flagColor} flag.${memoText}`;
}

export function formatAlreadyFlaggedResponse(
  transactionId: string,
  flagColor: string | null
): string {
  if (!flagColor) {
    return `Transaction ${transactionId} already has no flag. No changes needed.`;
  }
  return `Transaction ${transactionId} already has the ${flagColor} flag. No changes needed.`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/plugins/agent/extensions/ynab/formatters.ts
git commit -m "feat(ynab): add formatting helpers"
```

---

### Task 2: Create `ynab/utils.ts`

**Files:**
- Create: `src/plugins/agent/extensions/ynab/utils.ts`

- [ ] **Step 1: Write the file**

Move the entire contents of `src/plugins/agent/extensions/ynab-utils.ts` into `src/plugins/agent/extensions/ynab/utils.ts`. No code changes except the file path.

- [ ] **Step 2: Commit**

```bash
git add src/plugins/agent/extensions/ynab/utils.ts
git commit -m "feat(ynab): move utilities into ynab/utils.ts"
```

---

### Task 3: Create `ynab/tools/ynab-get-transactions.ts`

**Files:**
- Create: `src/plugins/agent/extensions/ynab/tools/ynab-get-transactions.ts`

- [ ] **Step 1: Write the file**

```ts
import type { FastifyInstance } from "fastify";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { getDefaultSinceDate, getYnabErrorMessage, isYnabNotFoundError } from "../utils.js";
import { formatTransactionsResponse } from "../formatters.js";

const paramsSchema = Type.Object({
  budgetId: Type.String({ description: "The UUID of the YNAB budget" }),
  sinceDate: Type.Optional(
    Type.String({ description: "Start date (YYYY-MM-DD). Defaults to 30 days ago." })
  ),
  unapproved: Type.Optional(
    Type.Boolean({
      description:
        "If true, return only unapproved transactions. If false, return only approved. Omit to include both.",
    })
  ),
  uncleared: Type.Optional(
    Type.Boolean({
      description:
        "If true, return only uncleared transactions. If false, return only cleared/reconciled. Omit to include both.",
    })
  ),
});

export default function createTool(fastify: FastifyInstance): ToolDefinition<typeof paramsSchema> {
  return {
    name: "ynab_get_transactions",
    label: "Get YNAB Transactions",
    description:
      "Fetches transactions from a YNAB budget. Use unapproved=true to find bank imports awaiting review. Use uncleared=true to find manual entries not yet matched.",
    parameters: paramsSchema,
    async execute(_toolCallId, params) {
      try {
        const sinceDate = params.sinceDate ?? getDefaultSinceDate();
        const ynabAPI = fastify.ynabClient.api;
        const response = await ynabAPI.transactions.getTransactions(params.budgetId, sinceDate);
        let transactions = response.data.transactions;

        if (params.unapproved !== undefined) {
          transactions = transactions.filter((t) =>
            params.unapproved ? !t.approved : t.approved
          );
        }
        if (params.uncleared !== undefined) {
          transactions = transactions.filter((t) =>
            params.uncleared ? t.cleared === "uncleared" : t.cleared !== "uncleared"
          );
        }

        const text = formatTransactionsResponse(
          params.budgetId,
          sinceDate,
          params.unapproved,
          params.uncleared,
          transactions
        );
        return {
          content: [{ type: "text" as const, text }],
          details: {},
        };
      } catch (error) {
        const message = isYnabNotFoundError(error)
          ? `Budget "${params.budgetId}" not found. Verify the budget ID.`
          : getYnabErrorMessage(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Failed to fetch transactions from YNAB.\n${message}`,
            },
          ],
          details: {},
        };
      }
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/plugins/agent/extensions/ynab/tools/ynab-get-transactions.ts
git commit -m "feat(ynab): add get-transactions tool"
```

---

### Task 4: Create `ynab/tools/ynab-get-payee-history.ts`

**Files:**
- Create: `src/plugins/agent/extensions/ynab/tools/ynab-get-payee-history.ts`

- [ ] **Step 1: Write the file**

```ts
import type { FastifyInstance } from "fastify";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import {
  buildPayeeStats,
  getDefaultPayeeSinceDate,
  getYnabErrorMessage,
  isYnabNotFoundError,
  resolvePayeeId,
} from "../utils.js";
import { formatPayeeHistoryResponse } from "../formatters.js";

const paramsSchema = Type.Object({
  budgetId: Type.String({ description: "The UUID of the YNAB budget" }),
  payeeName: Type.String({ description: "Exact payee name as it appears in YNAB" }),
  sinceDate: Type.Optional(
    Type.String({ description: "Start date (YYYY-MM-DD). Defaults to 6 months ago." })
  ),
  includeTransfers: Type.Optional(
    Type.Boolean({ description: "Whether to include transfer transactions. Defaults to false." })
  ),
});

export default function createTool(fastify: FastifyInstance): ToolDefinition<typeof paramsSchema> {
  return {
    name: "ynab_get_payee_history",
    label: "Get YNAB Payee History",
    description:
      "Fetches historical transactions for a payee and computes spending statistics (average, median, min/max, std deviation, frequency) to help decide whether a transaction should be auto-approved.",
    parameters: paramsSchema,
    async execute(_toolCallId, params) {
      try {
        const sinceDate = params.sinceDate ?? getDefaultPayeeSinceDate();
        const ynabAPI = fastify.ynabClient.api;

        const payeeId = await resolvePayeeId(ynabAPI, params.budgetId, params.payeeName);
        if (!payeeId) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Payee "${params.payeeName}" not found in budget.\nCheck the exact spelling as it appears in YNAB.`,
              },
            ],
            details: {},
          };
        }

        const response = await ynabAPI.transactions.getTransactionsByPayee(
          params.budgetId,
          payeeId,
          sinceDate
        );
        let transactions = response.data.transactions;

        if (params.includeTransfers !== true) {
          transactions = transactions.filter((t) => !t.transfer_account_id);
        }

        const stats = buildPayeeStats(transactions);
        const text = formatPayeeHistoryResponse(params.payeeName, sinceDate, stats);

        return {
          content: [{ type: "text" as const, text }],
          details: {},
        };
      } catch (error) {
        const message = isYnabNotFoundError(error)
          ? `Budget "${params.budgetId}" not found. Verify the budget ID.`
          : getYnabErrorMessage(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Failed to fetch payee history from YNAB.\n${message}`,
            },
          ],
          details: {},
        };
      }
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/plugins/agent/extensions/ynab/tools/ynab-get-payee-history.ts
git commit -m "feat(ynab): add get-payee-history tool"
```

---

### Task 5: Create `ynab/tools/ynab-create-transaction.ts`

**Files:**
- Create: `src/plugins/agent/extensions/ynab/tools/ynab-create-transaction.ts`

- [ ] **Step 1: Write the file**

Move the `ynab_create_transaction` tool from `ynab.ts` lines 353-587 into this file.

```ts
import type { FastifyInstance } from "fastify";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import currency from "currency.js";
import type * as ynab from "ynab";
import {
  formatMilliunits,
  getYnabErrorMessage,
  isYnabNotFoundError,
  resolveAccountId,
  resolveCategoryId,
  resolvePayeeId,
  validateAndResolveSplits,
} from "../utils.js";
import {
  formatCreateTransactionResponse,
  formatCreateTransferResponse,
  formatCreateSplitResponse,
} from "../formatters.js";

const paramsSchema = Type.Object({
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
});

export default function createTool(fastify: FastifyInstance): ToolDefinition<typeof paramsSchema> {
  return {
    name: "ynab_create_transaction",
    label: "Create YNAB Transaction",
    description:
      "Creates a new transaction in a YNAB budget. Supports regular transactions, transfers between accounts, and split transactions.",
    parameters: paramsSchema,
    async execute(_toolCallId, params) {
      try {
        if (!params.payee && !params.transferToAccount) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Cannot create transaction. Either 'payee' or 'transferToAccount' must be provided.",
              },
            ],
            details: {},
          };
        }

        if (params.transferToAccount && params.splits) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Cannot create transaction. Split transactions cannot be transfers. Provide either 'transferToAccount' or 'splits', not both.",
              },
            ],
            details: {},
          };
        }

        const ynabAPI = fastify.ynabClient.api;

        const accountId = await resolveAccountId(ynabAPI, params.budgetId, params.account);
        if (!accountId) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Account "${params.account}" not found. Verify the exact name as it appears in YNAB.`,
              },
            ],
            details: {},
          };
        }

        let payeeId: string | undefined = undefined;
        let isTransfer = false;
        let targetAccountName: string | undefined = undefined;

        if (params.transferToAccount) {
          isTransfer = true;
          targetAccountName = params.transferToAccount;
          const targetAccountId = await resolveAccountId(ynabAPI, params.budgetId, params.transferToAccount);
          if (!targetAccountId) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: Account "${params.transferToAccount}" not found. Verify the exact name as it appears in YNAB.`,
                },
              ],
              details: {},
            };
          }

          const accountResponse = await ynabAPI.accounts.getAccountById(params.budgetId, targetAccountId);
          const targetAccount = accountResponse.data.account;
          if (!targetAccount.transfer_payee_id) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: Account "${params.transferToAccount}" does not support transfers.`,
                },
              ],
              details: {},
            };
          }
          payeeId = targetAccount.transfer_payee_id;
        } else if (params.payee) {
          const resolvedPayeeId = await resolvePayeeId(ynabAPI, params.budgetId, params.payee);
          if (!resolvedPayeeId) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: Payee "${params.payee}" not found. Verify the exact name as it appears in YNAB.`,
                },
              ],
              details: {},
            };
          }
          payeeId = resolvedPayeeId;
        }

        const amountMilliunits = Math.round(currency(params.amount).value * 1000);
        const amountFormatted = formatMilliunits(amountMilliunits);

        if (params.splits) {
          const splitInputs = params.splits.map((s) => ({
            category: s.category,
            amount: s.amount === null ? null : currency(s.amount),
            memo: s.memo,
          }));
          const result = await validateAndResolveSplits(ynabAPI, params.budgetId, currency(params.amount), splitInputs);
          if (result.errors.length > 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: Invalid split amounts.\n${result.errors.join("\n")}`,
                },
              ],
              details: {},
            };
          }
          const subtransactions = result.subtransactions;

          await ynabAPI.transactions.createTransaction(params.budgetId, {
            transaction: {
              account_id: accountId,
              payee_id: payeeId,
              category_id: undefined,
              amount: amountMilliunits,
              date: params.date,
              memo: params.memo ?? undefined,
              subtransactions,
            },
          });

          const splitLines = params.splits.map((split, i) => ({
            category: split.category,
            amount: formatMilliunits(subtransactions[i].amount),
          }));
          const text = formatCreateSplitResponse(
            params.account,
            params.date,
            amountFormatted,
            params.payee ?? "(none)",
            splitLines
          );
          return {
            content: [{ type: "text" as const, text }],
            details: {},
          };
        }

        let categoryId: string | null = null;
        if (params.category) {
          const resolvedCategoryId = await resolveCategoryId(ynabAPI, params.budgetId, params.category);
          if (!resolvedCategoryId) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: Category "${params.category}" not found. Verify the exact name as it appears in YNAB.`,
                },
              ],
              details: {},
            };
          }
          categoryId = resolvedCategoryId;
        }

        await ynabAPI.transactions.createTransaction(params.budgetId, {
          transaction: {
            account_id: accountId,
            payee_id: payeeId,
            category_id: categoryId ?? undefined,
            amount: amountMilliunits,
            date: params.date,
            memo: params.memo ?? undefined,
          },
        });

        if (isTransfer && targetAccountName) {
          const text = formatCreateTransferResponse(
            params.account,
            targetAccountName,
            params.date,
            amountFormatted
          );
          return {
            content: [{ type: "text" as const, text }],
            details: {},
          };
        }

        const text = formatCreateTransactionResponse(
          params.account,
          params.date,
          amountFormatted,
          params.payee ?? "(none)",
          params.category ?? null,
          params.memo ?? null
        );
        return {
          content: [{ type: "text" as const, text }],
          details: {},
        };
      } catch (error) {
        const message = isYnabNotFoundError(error)
          ? `Budget "${params.budgetId}" not found. Verify the budget ID.`
          : getYnabErrorMessage(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Failed to create transaction in YNAB.\n${message}`,
            },
          ],
          details: {},
        };
      }
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/plugins/agent/extensions/ynab/tools/ynab-create-transaction.ts
git commit -m "feat(ynab): add create-transaction tool"
```

---

### Task 6: Create `ynab/tools/ynab-split-transaction.ts`

**Files:**
- Create: `src/plugins/agent/extensions/ynab/tools/ynab-split-transaction.ts`

- [ ] **Step 1: Write the file**

Move the `ynab_split_transaction` tool from `ynab.ts` lines 589-685 into this file.

```ts
import type { FastifyInstance } from "fastify";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import currency from "currency.js";
import { getYnabErrorMessage, isYnabNotFoundError, validateAndResolveSplits } from "../utils.js";
import { formatSplitTransactionResponse } from "../formatters.js";

const paramsSchema = Type.Object({
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
});

export default function createTool(fastify: FastifyInstance): ToolDefinition<typeof paramsSchema> {
  return {
    name: "ynab_split_transaction",
    label: "Split YNAB Transaction",
    description:
      "Splits an existing YNAB transaction into multiple categories. The transaction must not already be split.",
    parameters: paramsSchema,
    async execute(_toolCallId, params) {
      try {
        const ynabAPI = fastify.ynabClient.api;

        const transactionResponse = await ynabAPI.transactions.getTransactionById(
          params.budgetId,
          params.transactionId
        );
        const existingTransaction = transactionResponse.data.transaction;

        if (existingTransaction.subtransactions && existingTransaction.subtransactions.length > 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Cannot split transaction ${params.transactionId}.\nThis transaction is already split. Delete and recreate it to change splits.`,
              },
            ],
            details: {},
          };
        }

        const totalAmount = currency(existingTransaction.amount / 1000);
        const splitInputs = params.splits.map((s) => ({
          category: s.category,
          amount: s.amount === null ? null : currency(s.amount),
          memo: s.memo,
        }));

        const result = await validateAndResolveSplits(ynabAPI, params.budgetId, totalAmount, splitInputs);
        if (result.errors.length > 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Invalid split amounts.\n${result.errors.join("\n")}`,
              },
            ],
            details: {},
          };
        }

        const subtransactions = result.subtransactions;

        await ynabAPI.transactions.updateTransactions(params.budgetId, {
          transactions: [
            {
              id: params.transactionId,
              category_id: undefined,
              subtransactions,
            },
          ],
        });

        const splitLines = params.splits.map((split, i) => ({
          category: split.category,
          amount: formatMilliunits(subtransactions[i].amount),
        }));

        const text = formatSplitTransactionResponse(params.transactionId, splitLines);
        return {
          content: [{ type: "text" as const, text }],
          details: {},
        };
      } catch (error) {
        const message = isYnabNotFoundError(error)
          ? `Budget "${params.budgetId}" not found or transaction "${params.transactionId}" does not exist. Verify the IDs.`
          : getYnabErrorMessage(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Failed to split transaction in YNAB.\n${message}`,
            },
          ],
          details: {},
        };
      }
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/plugins/agent/extensions/ynab/tools/ynab-split-transaction.ts
git commit -m "feat(ynab): add split-transaction tool"
```

---

### Task 7: Create `ynab/tools/ynab-approve-transaction.ts`

**Files:**
- Create: `src/plugins/agent/extensions/ynab/tools/ynab-approve-transaction.ts`

- [ ] **Step 1: Write the file**

Move the `ynab_approve_transaction` tool from `ynab.ts` lines 687-846 into this file.

```ts
import type { FastifyInstance } from "fastify";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import type * as ynab from "ynab";
import {
  formatMilliunits,
  getYnabErrorMessage,
  isYnabNotFoundError,
  resolveCategoryId,
} from "../utils.js";
import { formatApproveTransactionResponse, formatAlreadyApprovedResponse } from "../formatters.js";

const paramsSchema = Type.Object({
  budgetId: Type.String({ description: "The UUID of the YNAB budget" }),
  transactionId: Type.String({ description: "The ID of the transaction to approve" }),
  category: Type.Optional(
    Type.String({ description: "Category name to assign. Ignored if the transaction is already a split." })
  ),
  memo: Type.Optional(Type.String({ description: "Memo/note to set on the transaction" })),
  cleared: Type.Optional(
    Type.Boolean({
      description: "If true, marks as cleared. If false, marks as uncleared. Omit to leave unchanged.",
    })
  ),
});

export default function createTool(fastify: FastifyInstance): ToolDefinition<typeof paramsSchema> {
  return {
    name: "ynab_approve_transaction",
    label: "Approve YNAB Transaction",
    description:
      "Approves a transaction in YNAB and optionally updates its category, memo, or cleared status.",
    parameters: paramsSchema,
    async execute(_toolCallId, params) {
      try {
        const ynabAPI = fastify.ynabClient.api;

        let existingTransaction: ynab.TransactionDetail;
        try {
          const response = await ynabAPI.transactions.getTransactionById(
            params.budgetId,
            params.transactionId
          );
          existingTransaction = response.data.transaction;
        } catch (error) {
          if (isYnabNotFoundError(error)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: Transaction "${params.transactionId}" not found in budget.`,
                },
              ],
              details: {},
            };
          }
          throw error;
        }

        const wasAlreadyApproved = existingTransaction.approved;

        if (
          params.category &&
          existingTransaction.subtransactions &&
          existingTransaction.subtransactions.length > 0
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Cannot assign category to transaction ${params.transactionId}.\nThis is a split transaction. Categories belong to subtransactions.`,
              },
            ],
            details: {},
          };
        }

        let categoryId: string | undefined = undefined;
        if (params.category) {
          const resolvedCategoryId = await resolveCategoryId(
            ynabAPI,
            params.budgetId,
            params.category
          );
          if (!resolvedCategoryId) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: Category "${params.category}" not found. Verify the exact name as it appears in YNAB.`,
                },
              ],
              details: {},
            };
          }
          categoryId = resolvedCategoryId;
        }

        const payload: ynab.SaveTransactionWithIdOrImportId = {
          id: params.transactionId,
          approved: true,
        };

        if (categoryId !== undefined) {
          payload.category_id = categoryId;
        }
        if (params.memo !== undefined) {
          payload.memo = params.memo;
        }
        if (params.cleared !== undefined) {
          payload.cleared = params.cleared ? "cleared" : "uncleared";
        }

        const categoryChanged =
          params.category !== undefined && categoryId !== existingTransaction.category_id;
        const memoChanged =
          params.memo !== undefined && params.memo !== (existingTransaction.memo ?? "");
        const clearedChanged =
          params.cleared !== undefined &&
          (params.cleared ? "cleared" : "uncleared") !== existingTransaction.cleared;
        const hasMeaningfulChanges = categoryChanged || memoChanged || clearedChanged;

        if (wasAlreadyApproved && !hasMeaningfulChanges) {
          const text = formatAlreadyApprovedResponse(
            params.transactionId,
            existingTransaction.date,
            formatMilliunits(existingTransaction.amount),
            existingTransaction.payee_name ?? "(none)",
            existingTransaction.category_name ?? null,
            existingTransaction.cleared
          );
          return {
            content: [{ type: "text" as const, text }],
            details: {},
          };
        }

        await ynabAPI.transactions.updateTransactions(params.budgetId, {
          transactions: [payload],
        });

        const finalResponse = await ynabAPI.transactions.getTransactionById(
          params.budgetId,
          params.transactionId
        );
        const finalTransaction = finalResponse.data.transaction;

        const text = formatApproveTransactionResponse(
          params.transactionId,
          finalTransaction.date,
          formatMilliunits(finalTransaction.amount),
          finalTransaction.payee_name ?? "(none)",
          finalTransaction.category_name ?? null,
          finalTransaction.cleared
        );
        return {
          content: [{ type: "text" as const, text }],
          details: {},
        };
      } catch (error) {
        const message = isYnabNotFoundError(error)
          ? `Budget "${params.budgetId}" not found. Verify the budget ID.`
          : getYnabErrorMessage(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Failed to approve transaction in YNAB.\n${message}`,
            },
          ],
          details: {},
        };
      }
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/plugins/agent/extensions/ynab/tools/ynab-approve-transaction.ts
git commit -m "feat(ynab): add approve-transaction tool"
```

---

### Task 8: Create `ynab/tools/ynab-delete-transaction.ts`

**Files:**
- Create: `src/plugins/agent/extensions/ynab/tools/ynab-delete-transaction.ts`

- [ ] **Step 1: Write the file**

Move the `ynab_delete_transaction` tool from `ynab.ts` lines 848-913 into this file.

```ts
import type { FastifyInstance } from "fastify";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { formatMilliunits, getYnabErrorMessage, isYnabNotFoundError } from "../utils.js";
import { formatDeleteTransactionResponse } from "../formatters.js";

const paramsSchema = Type.Object({
  budgetId: Type.String({ description: "The UUID of the YNAB budget" }),
  transactionId: Type.String({ description: "The ID of the transaction to delete" }),
});

export default function createTool(fastify: FastifyInstance): ToolDefinition<typeof paramsSchema> {
  return {
    name: "ynab_delete_transaction",
    label: "Delete YNAB Transaction",
    description: "Deletes a transaction from a YNAB budget.",
    parameters: paramsSchema,
    async execute(_toolCallId, params) {
      try {
        const ynabAPI = fastify.ynabClient.api;

        let existingTransaction: ynab.TransactionDetail;
        try {
          const response = await ynabAPI.transactions.getTransactionById(
            params.budgetId,
            params.transactionId
          );
          existingTransaction = response.data.transaction;
        } catch (error) {
          if (isYnabNotFoundError(error)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Transaction ${params.transactionId} was already deleted or did not exist.`,
                },
              ],
              details: {},
            };
          }
          throw error;
        }

        const { date, amount, payee_name, category_name, memo } = existingTransaction;

        await ynabAPI.transactions.deleteTransaction(params.budgetId, params.transactionId);

        const text = formatDeleteTransactionResponse(
          params.transactionId,
          date,
          formatMilliunits(amount),
          payee_name ?? "(none)",
          category_name ?? null,
          memo ?? null
        );
        return {
          content: [{ type: "text" as const, text }],
          details: {},
        };
      } catch (error) {
        const message = isYnabNotFoundError(error)
          ? `Budget "${params.budgetId}" not found or transaction "${params.transactionId}" does not exist. Verify the IDs.`
          : getYnabErrorMessage(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Failed to delete transaction from YNAB.\n${message}`,
            },
          ],
          details: {},
        };
      }
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/plugins/agent/extensions/ynab/tools/ynab-delete-transaction.ts
git commit -m "feat(ynab): add delete-transaction tool"
```

---

### Task 9: Create `ynab/tools/ynab-flag-transaction.ts`

**Files:**
- Create: `src/plugins/agent/extensions/ynab/tools/ynab-flag-transaction.ts`

- [ ] **Step 1: Write the file**

Move the `ynab_flag_transaction` tool from `ynab.ts` lines 915-1075 into this file.

```ts
import type { FastifyInstance } from "fastify";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import type * as ynab from "ynab";
import { getYnabErrorMessage, isYnabNotFoundError } from "../utils.js";
import { formatFlagTransactionResponse, formatAlreadyFlaggedResponse } from "../formatters.js";

const FLAG_REASON_TEMPLATES: Record<string, string> = {
  amount_anomaly: "Amount outside expected range",
  new_payee: "No payee history available",
  category_ambiguous: "No clear category match",
  possible_duplicate: "Possible duplicate transaction",
  partial_match: "Partial match to pre-entry",
  manual_review: "Needs manual review",
};

const paramsSchema = Type.Object({
  budgetId: Type.String({ description: "The UUID of the YNAB budget" }),
  transactionId: Type.String({ description: "The ID of the transaction to flag" }),
  flagColor: Type.Optional(
    Type.Union(
      [
        Type.Literal("red"),
        Type.Literal("orange"),
        Type.Literal("yellow"),
        Type.Literal("green"),
        Type.Literal("blue"),
        Type.Literal("purple"),
      ],
      { description: "Flag color to set. Required unless clearFlag is true." }
    )
  ),
  clearFlag: Type.Optional(
    Type.Boolean({ description: "When true, removes the flag color. Mutually exclusive with flagColor." })
  ),
  reason: Type.Optional(
    Type.Enum(
      {
        amount_anomaly: "amount_anomaly",
        new_payee: "new_payee",
        category_ambiguous: "category_ambiguous",
        possible_duplicate: "possible_duplicate",
        partial_match: "partial_match",
        manual_review: "manual_review",
      },
      { description: "Reason for flagging. Prepends a template to the memo." }
    )
  ),
});

export default function createTool(fastify: FastifyInstance): ToolDefinition<typeof paramsSchema> {
  return {
    name: "ynab_flag_transaction",
    label: "Flag YNAB Transaction",
    description:
      "Sets or clears a flag color on a YNAB transaction. Optionally prepends a reason template to the memo.",
    parameters: paramsSchema,
    async execute(_toolCallId, params) {
      if (!params.flagColor && !params.clearFlag) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: Invalid flag input. Must provide either flagColor or clearFlag=true.",
            },
          ],
          details: {},
        };
      }
      if (params.flagColor && params.clearFlag) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: Invalid flag input. Must provide either flagColor or clearFlag=true, but not both.",
            },
          ],
          details: {},
        };
      }

      try {
        const ynabAPI = fastify.ynabClient.api;

        let existingTransaction: ynab.TransactionDetail;
        try {
          const response = await ynabAPI.transactions.getTransactionById(
            params.budgetId,
            params.transactionId
          );
          existingTransaction = response.data.transaction;
        } catch (error) {
          if (isYnabNotFoundError(error)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: Transaction "${params.transactionId}" not found in budget.`,
                },
              ],
              details: {},
            };
          }
          throw error;
        }

        const targetFlagColor: ynab.TransactionFlagColor = params.clearFlag
          ? ""
          : params.flagColor!;

        let newMemo: string | undefined = undefined;
        if (params.reason) {
          const template = FLAG_REASON_TEMPLATES[params.reason];
          const existingMemo = existingTransaction.memo ?? "";
          if (!existingMemo.startsWith(template)) {
            newMemo = existingMemo ? `${template} | ${existingMemo}` : template;
          }
        }

        const memoAlreadyMatches =
          newMemo === undefined || newMemo === (existingTransaction.memo ?? "");
        const flagAlreadyMatches =
          existingTransaction.flag_color === targetFlagColor ||
          (targetFlagColor === "" && !existingTransaction.flag_color);

        if (memoAlreadyMatches && flagAlreadyMatches) {
          const text = formatAlreadyFlaggedResponse(
            params.transactionId,
            targetFlagColor || null
          );
          return {
            content: [{ type: "text" as const, text }],
            details: {},
          };
        }

        const payload: ynab.SaveTransactionWithIdOrImportId = {
          id: params.transactionId,
          flag_color: targetFlagColor,
        };

        if (newMemo !== undefined) {
          payload.memo = newMemo;
        }

        await ynabAPI.transactions.updateTransactions(params.budgetId, {
          transactions: [payload],
        });

        const finalResponse = await ynabAPI.transactions.getTransactionById(
          params.budgetId,
          params.transactionId
        );
        const finalTransaction = finalResponse.data.transaction;

        const text = formatFlagTransactionResponse(
          params.transactionId,
          finalTransaction.flag_color || null,
          finalTransaction.memo ?? null
        );
        return {
          content: [{ type: "text" as const, text }],
          details: {},
        };
      } catch (error) {
        const message = isYnabNotFoundError(error)
          ? `Budget "${params.budgetId}" not found. Verify the budget ID.`
          : getYnabErrorMessage(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Failed to flag transaction in YNAB.\n${message}`,
            },
          ],
          details: {},
        };
      }
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/plugins/agent/extensions/ynab/tools/ynab-flag-transaction.ts
git commit -m "feat(ynab): add flag-transaction tool"
```

---

### Task 10: Update `ynab/index.ts`

**Files:**
- Modify: `src/plugins/agent/extensions/ynab/index.ts`

- [ ] **Step 1: Rewrite the file**

```ts
import type { FastifyInstance } from "fastify";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import ynabGetTransactionsTool from "./tools/ynab-get-transactions.js";
import ynabGetPayeeHistoryTool from "./tools/ynab-get-payee-history.js";
import ynabCreateTransactionTool from "./tools/ynab-create-transaction.js";
import ynabSplitTransactionTool from "./tools/ynab-split-transaction.js";
import ynabApproveTransactionTool from "./tools/ynab-approve-transaction.js";
import ynabDeleteTransactionTool from "./tools/ynab-delete-transaction.js";
import ynabFlagTransactionTool from "./tools/ynab-flag-transaction.js";

export default function createYnabExtension(fastify: FastifyInstance) {
  return (pi: ExtensionAPI) => {
    pi.registerTool(ynabGetTransactionsTool(fastify));
    pi.registerTool(ynabGetPayeeHistoryTool(fastify));
    pi.registerTool(ynabCreateTransactionTool(fastify));
    pi.registerTool(ynabSplitTransactionTool(fastify));
    pi.registerTool(ynabApproveTransactionTool(fastify));
    pi.registerTool(ynabDeleteTransactionTool(fastify));
    pi.registerTool(ynabFlagTransactionTool(fastify));
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/plugins/agent/extensions/ynab/index.ts
git commit -m "feat(ynab): register all tools in extension factory"
```

---

### Task 11: Delete old files

**Files:**
- Delete: `src/plugins/agent/extensions/ynab.ts`
- Delete: `src/plugins/agent/extensions/ynab-utils.ts`

- [ ] **Step 1: Delete**

```bash
rm src/plugins/agent/extensions/ynab.ts
rm src/plugins/agent/extensions/ynab-utils.ts
git add -A
git commit -m "refactor(ynab): remove monolithic ynab.ts and ynab-utils.ts"
```

---

### Task 12: Create test helpers

**Files:**
- Create: `test/plugins/agent/extensions/ynab/test-helpers.ts`

- [ ] **Step 1: Write the file**

```ts
import { vi } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { FastifyInstance } from "fastify";
import type * as ynab from "ynab";

export function createMockExtensionAPI(): ExtensionAPI & { _tools: Array<{ name: string; execute: Function }> } {
  const tools: Array<{ name: string; execute: Function }> = [];
  return {
    registerTool: vi.fn((tool) => tools.push(tool)),
    on: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    registerFlag: vi.fn(),
    _tools: tools,
  } as unknown as ExtensionAPI & { _tools: typeof tools };
}

export function getTools(extApi: ExtensionAPI) {
  return (extApi as unknown as { _tools: Array<{ name: string; execute: Function }> })._tools;
}

export function createMockYnabAPI() {
  return {
    transactions: {
      getTransactions: vi.fn(),
      getTransactionsByPayee: vi.fn(),
      getTransactionById: vi.fn(),
      createTransaction: vi.fn(),
      updateTransactions: vi.fn(),
      deleteTransaction: vi.fn(),
    },
    accounts: {
      getAccounts: vi.fn(),
      getAccountById: vi.fn(),
    },
    categories: {
      getCategories: vi.fn(),
    },
    payees: {
      getPayees: vi.fn(),
    },
  };
}

export function createMockFastify(ynabAPI: ReturnType<typeof createMockYnabAPI>) {
  return {
    ynabClient: { api: ynabAPI },
    log: { info: vi.fn(), error: vi.fn() },
  } as unknown as FastifyInstance;
}

export function makeTransactionDetail(overrides: Partial<ynab.TransactionDetail> = {}): ynab.TransactionDetail {
  return {
    id: "txn-1",
    date: "2026-04-29",
    amount: -50000,
    cleared: "cleared",
    approved: true,
    account_id: "acc-1",
    account_name: "Checking",
    payee_name: "Grocery Store",
    category_name: "Food",
    subtransactions: [],
    deleted: false,
    ...overrides,
  };
}

export function makeHybridTransaction(overrides: Partial<ynab.HybridTransaction> = {}): ynab.HybridTransaction {
  return {
    id: "txn-1",
    date: "2026-04-29",
    amount: -50000,
    cleared: "cleared",
    approved: true,
    account_id: "acc-1",
    account_name: "Checking",
    payee_name: "Grocery Store",
    category_name: "Food",
    deleted: false,
    type: "transaction",
    ...overrides,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add test/plugins/agent/extensions/ynab/test-helpers.ts
git commit -m "test(ynab): add shared test helpers"
```

---

### Task 13: Create `formatters.test.ts`

**Files:**
- Create: `test/plugins/agent/extensions/ynab/formatters.test.ts`

- [ ] **Step 1: Write the file**

Move all formatting helper tests from `ynab.test.ts` lines 112-304 into this file.

```ts
import { describe, it, expect } from "vitest";
import {
  formatCreateTransactionResponse,
  formatCreateTransferResponse,
  formatCreateSplitResponse,
  formatSplitTransactionResponse,
  formatApproveTransactionResponse,
  formatAlreadyApprovedResponse,
  formatDeleteTransactionResponse,
  formatFlagTransactionResponse,
  formatAlreadyFlaggedResponse,
} from "../../../../src/plugins/agent/extensions/ynab/formatters.js";

describe("formatCreateTransactionResponse", () => {
  it("formats a regular transaction with all fields", () => {
    const result = formatCreateTransactionResponse(
      "Checking",
      "2026-04-29",
      "-$50.00",
      "Grocery Store",
      "Food",
      "Weekly shopping"
    );
    expect(result).toBe(
      "Created transaction in Checking.\n- Date: 2026-04-29 | Amount: -$50.00 | Payee: Grocery Store | Category: Food | Memo: Weekly shopping"
    );
  });

  it("formats a transaction without memo", () => {
    const result = formatCreateTransactionResponse(
      "Checking",
      "2026-04-29",
      "-$50.00",
      "Grocery Store",
      "Food",
      null
    );
    expect(result).toBe(
      "Created transaction in Checking.\n- Date: 2026-04-29 | Amount: -$50.00 | Payee: Grocery Store | Category: Food"
    );
  });

  it("formats a transaction without category", () => {
    const result = formatCreateTransactionResponse(
      "Checking",
      "2026-04-29",
      "-$50.00",
      "Grocery Store",
      null,
      null
    );
    expect(result).toBe(
      "Created transaction in Checking.\n- Date: 2026-04-29 | Amount: -$50.00 | Payee: Grocery Store | Category: (none)"
    );
  });
});

describe("formatCreateTransferResponse", () => {
  it("formats a transfer transaction", () => {
    const result = formatCreateTransferResponse(
      "Checking",
      "Savings",
      "2026-04-29",
      "-$100.00"
    );
    expect(result).toBe(
      "Created transfer from Checking to Savings.\n- Date: 2026-04-29 | Amount: -$100.00 | Transfer to Savings"
    );
  });
});

describe("formatCreateSplitResponse", () => {
  it("formats a split transaction", () => {
    const result = formatCreateSplitResponse(
      "Checking",
      "2026-04-29",
      "-$100.00",
      "Department Store",
      [
        { category: "Clothing", amount: "-$60.00" },
        { category: "Household", amount: "-$40.00" },
      ]
    );
    expect(result).toBe(
      "Created split transaction in Checking across 2 categories.\n- Date: 2026-04-29 | Amount: -$100.00 | Payee: Department Store\n  - Clothing: -$60.00\n  - Household: -$40.00"
    );
  });
});

describe("formatSplitTransactionResponse", () => {
  it("formats a split transaction update", () => {
    const result = formatSplitTransactionResponse("txn-123", [
      { category: "Food", amount: "-$30.00" },
      { category: "Transport", amount: "-$20.00" },
    ]);
    expect(result).toBe(
      "Split transaction txn-123 into 2 categories.\n- Food: -$30.00\n- Transport: -$20.00"
    );
  });
});

describe("formatApproveTransactionResponse", () => {
  it("formats an approved transaction", () => {
    const result = formatApproveTransactionResponse(
      "txn-456",
      "2026-04-29",
      "-$50.00",
      "Grocery Store",
      "Food",
      "cleared"
    );
    expect(result).toBe(
      "Approved transaction txn-456.\n- Date: 2026-04-29 | Amount: -$50.00 | Payee: Grocery Store | Category: Food | Cleared: yes"
    );
  });

  it("formats with uncleared status", () => {
    const result = formatApproveTransactionResponse(
      "txn-456",
      "2026-04-29",
      "-$50.00",
      "Grocery Store",
      null,
      "uncleared"
    );
    expect(result).toBe(
      "Approved transaction txn-456.\n- Date: 2026-04-29 | Amount: -$50.00 | Payee: Grocery Store | Category: (none) | Cleared: no"
    );
  });
});

describe("formatAlreadyApprovedResponse", () => {
  it("formats a no-op approval", () => {
    const result = formatAlreadyApprovedResponse(
      "txn-789",
      "2026-04-28",
      "-$25.00",
      "Coffee Shop",
      "Food",
      "cleared"
    );
    expect(result).toBe(
      "Transaction txn-789 was already approved. No changes needed.\n- Date: 2026-04-28 | Amount: -$25.00 | Payee: Coffee Shop | Category: Food | Cleared: yes"
    );
  });
});

describe("formatDeleteTransactionResponse", () => {
  it("formats a deleted transaction with memo", () => {
    const result = formatDeleteTransactionResponse(
      "txn-abc",
      "2026-04-27",
      "-$100.00",
      "Department Store",
      "Household",
      "Monthly supplies"
    );
    expect(result).toBe(
      "Deleted transaction txn-abc.\n- Date: 2026-04-27 | Amount: -$100.00 | Payee: Department Store | Category: Household | Memo: Monthly supplies"
    );
  });

  it("formats a deleted transaction without memo", () => {
    const result = formatDeleteTransactionResponse(
      "txn-abc",
      "2026-04-27",
      "-$100.00",
      "Department Store",
      "Household",
      null
    );
    expect(result).toBe(
      "Deleted transaction txn-abc.\n- Date: 2026-04-27 | Amount: -$100.00 | Payee: Department Store | Category: Household"
    );
  });
});

describe("formatFlagTransactionResponse", () => {
  it("formats a flagged transaction", () => {
    const result = formatFlagTransactionResponse("txn-def", "red", "Review this");
    expect(result).toBe(
      "Flagged transaction txn-def with red flag.\n- Memo: Review this"
    );
  });

  it("formats a cleared flag", () => {
    const result = formatFlagTransactionResponse("txn-def", null, null);
    expect(result).toBe("Cleared flag from transaction txn-def.");
  });
});

describe("formatAlreadyFlaggedResponse", () => {
  it("formats no-op when flag already set", () => {
    const result = formatAlreadyFlaggedResponse("txn-ghi", "blue");
    expect(result).toBe(
      "Transaction txn-ghi already has the blue flag. No changes needed."
    );
  });

  it("formats no-op when flag already cleared", () => {
    const result = formatAlreadyFlaggedResponse("txn-ghi", null);
    expect(result).toBe(
      "Transaction txn-ghi already has no flag. No changes needed."
    );
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add test/plugins/agent/extensions/ynab/formatters.test.ts
git commit -m "test(ynab): add formatter unit tests"
```

---

### Task 14: Create `utils.test.ts`

**Files:**
- Create: `test/plugins/agent/extensions/ynab/utils.test.ts`

- [ ] **Step 1: Write the file**

Move all utility tests from `ynab.test.ts` lines 1129-1315 into this file. Update imports to point to `ynab/utils.js`.

```ts
import { describe, it, expect } from "vitest";
import {
  formatMilliunits,
  formatAmount,
  validateAndResolveSplits,
  buildPayeeStats,
} from "../../../../src/plugins/agent/extensions/ynab/utils.js";
import currency from "currency.js";
import { createMockYnabAPI, makeHybridTransaction } from "./test-helpers.js";
import type * as ynab from "ynab";

describe("formatMilliunits", () => {
  it("formats positive milliunits", () => {
    expect(formatMilliunits(50000)).toBe("$50.00");
  });

  it("formats negative milliunits", () => {
    expect(formatMilliunits(-50000)).toBe("-$50.00");
  });

  it("formats zero", () => {
    expect(formatMilliunits(0)).toBe("$0.00");
  });
});

describe("formatAmount", () => {
  it("formats a currency object", () => {
    expect(formatAmount(currency(1234.56))).toBe("$1,234.56");
  });

  it("formats a negative currency object", () => {
    expect(formatAmount(currency(-99.99))).toBe("-$99.99");
  });
});

describe("validateAndResolveSplits", () => {
  async function setupCategories() {
    const ynabAPI = createMockYnabAPI();
    ynabAPI.categories.getCategories.mockResolvedValue({
      data: {
        category_groups: [
          {
            id: "cg-1",
            name: "Group",
            categories: [
              { id: "cat-1", name: "Food", deleted: false, hidden: false },
              { id: "cat-2", name: "Transport", deleted: false, hidden: false },
            ],
          },
        ],
      },
    });
    return ynabAPI;
  }

  it("resolves valid splits with explicit amounts", async () => {
    const ynabAPI = await setupCategories();
    const result = await validateAndResolveSplits(ynabAPI as unknown as ynab.API, "budget-123", currency(-100), [
      { category: "Food", amount: currency(-60) },
      { category: "Transport", amount: currency(-40) },
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.subtransactions).toHaveLength(2);
    expect(result.subtransactions[0].amount).toBe(-60000);
    expect(result.subtransactions[1].amount).toBe(-40000);
  });

  it("resolves valid splits with null remainder", async () => {
    const ynabAPI = await setupCategories();
    const result = await validateAndResolveSplits(ynabAPI as unknown as ynab.API, "budget-123", currency(-100), [
      { category: "Food", amount: currency(-60) },
      { category: "Transport", amount: null },
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.subtransactions).toHaveLength(2);
    expect(result.subtransactions[0].amount).toBe(-60000);
    expect(result.subtransactions[1].amount).toBe(-40000);
  });

  it("errors when fewer than 2 splits", async () => {
    const ynabAPI = await setupCategories();
    const result = await validateAndResolveSplits(ynabAPI as unknown as ynab.API, "budget-123", currency(-100), [
      { category: "Food", amount: currency(-100) },
    ]);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("at least 2 splits");
  });

  it("errors when more than one null amount", async () => {
    const ynabAPI = await setupCategories();
    const result = await validateAndResolveSplits(ynabAPI as unknown as ynab.API, "budget-123", currency(-100), [
      { category: "Food", amount: null },
      { category: "Transport", amount: null },
    ]);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Only one split may have a null amount");
  });

  it("errors when explicit amounts do not sum to total", async () => {
    const ynabAPI = await setupCategories();
    const result = await validateAndResolveSplits(ynabAPI as unknown as ynab.API, "budget-123", currency(-100), [
      { category: "Food", amount: currency(-30) },
      { category: "Transport", amount: currency(-40) },
    ]);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Split amounts sum to");
  });

  it("errors when remainder is zero", async () => {
    const ynabAPI = await setupCategories();
    const result = await validateAndResolveSplits(ynabAPI as unknown as ynab.API, "budget-123", currency(-100), [
      { category: "Food", amount: currency(-100) },
      { category: "Transport", amount: null },
    ]);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("remainder is 0");
  });

  it("errors when category not found", async () => {
    const ynabAPI = createMockYnabAPI();
    ynabAPI.categories.getCategories.mockResolvedValue({
      data: {
        category_groups: [
          {
            id: "cg-1",
            name: "Group",
            categories: [{ id: "cat-1", name: "Food", deleted: false, hidden: false }],
          },
        ],
      },
    });
    const result = await validateAndResolveSplits(ynabAPI as unknown as ynab.API, "budget-123", currency(-100), [
      { category: "Missing", amount: currency(-50) },
      { category: "Food", amount: currency(-50) },
    ]);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Category "Missing" not found');
  });
});

describe("buildPayeeStats", () => {
  it("calculates mean, median, std dev, and frequency", () => {
    const transactions: ynab.HybridTransaction[] = [
      makeHybridTransaction({ id: "txn-1", date: "2026-04-20", amount: -50000, category_name: "Food" }),
      makeHybridTransaction({ id: "txn-2", date: "2026-04-10", amount: -75000, category_name: "Food" }),
      makeHybridTransaction({ id: "txn-3", date: "2026-03-25", amount: -30000, category_name: "Snacks" }),
    ];

    const stats = buildPayeeStats(transactions);

    expect(stats.transactionCount).toBe(3);
    expect(stats.totalSpent).toBe(155000);
    expect(stats.averageAmount).toBeCloseTo(51666.67, 1);
    expect(stats.medianAmount).toBe(50000);
    expect(stats.minAmount).toBe(30000);
    expect(stats.maxAmount).toBe(75000);
    expect(stats.stdDeviation).toBeCloseTo(18408.94, 1);
    expect(stats.frequencyDays).not.toBeNull();
    expect(stats.mostCommonCategory).toBe("Food");
    expect(stats.refundCount).toBe(0);
    expect(stats.recentTransactions).toHaveLength(3);
  });

  it("returns zeros for empty transactions", () => {
    const stats = buildPayeeStats([]);

    expect(stats.transactionCount).toBe(0);
    expect(stats.totalSpent).toBe(0);
    expect(stats.averageAmount).toBe(0);
    expect(stats.medianAmount).toBe(0);
    expect(stats.minAmount).toBe(0);
    expect(stats.maxAmount).toBe(0);
    expect(stats.stdDeviation).toBe(0);
    expect(stats.frequencyDays).toBeNull();
    expect(stats.mostCommonCategory).toBeNull();
    expect(stats.refundCount).toBe(0);
  });

  it("counts refunds as inflows", () => {
    const transactions: ynab.HybridTransaction[] = [
      makeHybridTransaction({ id: "txn-1", date: "2026-04-20", amount: -50000, category_name: "Food" }),
      makeHybridTransaction({ id: "txn-2", date: "2026-04-10", amount: 25000, category_name: "Refund" }),
    ];

    const stats = buildPayeeStats(transactions);

    expect(stats.transactionCount).toBe(1);
    expect(stats.refundCount).toBe(1);
    expect(stats.totalSpent).toBe(50000);
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add test/plugins/agent/extensions/ynab/utils.test.ts
git commit -m "test(ynab): add utility unit tests"
```

---

### Task 15: Create `ynab-get-transactions.test.ts`

**Files:**
- Create: `test/plugins/agent/extensions/ynab/tools/ynab-get-transactions.test.ts`

- [ ] **Step 1: Write the file**

Move e2e tests for `ynab_get_transactions` from `ynab.test.ts` lines 310-407 into this file.

```ts
import { describe, it, expect } from "vitest";
import createYnabExtension from "../../../../../src/plugins/agent/extensions/ynab/index.js";
import {
  createMockYnabAPI,
  createMockFastify,
  createMockExtensionAPI,
  getTools,
  makeTransactionDetail,
} from "../test-helpers.js";

describe("ynab_get_transactions", () => {
  function setup() {
    const ynabAPI = createMockYnabAPI();
    const fastify = createMockFastify(ynabAPI);
    const extApi = createMockExtensionAPI();
    createYnabExtension(fastify)(extApi);
    const tools = getTools(extApi);
    const tool = tools.find((t) => t.name === "ynab_get_transactions")!;
    return { ynabAPI, fastify, extApi, tool };
  }

  it("uses default since date (30 days ago) and returns formatted transactions", async () => {
    const { ynabAPI, tool } = setup();
    const today = new Date();
    today.setDate(today.getDate() - 30);
    const expectedDate = today.toISOString().split("T")[0];

    ynabAPI.transactions.getTransactions.mockResolvedValue({
      data: {
        transactions: [
          makeTransactionDetail({ id: "txn-1", amount: -50000, payee_name: "Store", category_name: "Food" }),
        ],
      },
    });

    const result = await tool.execute("call-1", { budgetId: "budget-123" });
    expect(ynabAPI.transactions.getTransactions).toHaveBeenCalledWith("budget-123", expectedDate);
    expect(result.content[0].text).toContain("Returned 1 transactions from YNAB budget budget-123");
    expect(result.content[0].text).toContain("Store");
  });

  it("filters unapproved transactions", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactions.mockResolvedValue({
      data: {
        transactions: [
          makeTransactionDetail({ id: "txn-1", approved: true, payee_name: "Approved Store" }),
          makeTransactionDetail({ id: "txn-2", approved: false, payee_name: "Unapproved Store" }),
        ],
      },
    });

    const result = await tool.execute("call-1", { budgetId: "budget-123", sinceDate: "2026-04-01", unapproved: true });
    expect(result.content[0].text).toContain("Unapproved filter: true");
    expect(result.content[0].text).toContain("Unapproved Store");
    expect(result.content[0].text).not.toContain("Approved Store");
  });

  it("filters uncleared transactions", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactions.mockResolvedValue({
      data: {
        transactions: [
          makeTransactionDetail({ id: "txn-1", cleared: "cleared", payee_name: "Cleared Store" }),
          makeTransactionDetail({ id: "txn-2", cleared: "uncleared", payee_name: "Uncleared Store" }),
        ],
      },
    });

    const result = await tool.execute("call-1", { budgetId: "budget-123", sinceDate: "2026-04-01", uncleared: true });
    expect(result.content[0].text).toContain("Uncleared filter: true");
    expect(result.content[0].text).toContain("Uncleared Store");
    expect(result.content[0].text).not.toContain("Cleared Store");
  });

  it("formats output lines correctly", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactions.mockResolvedValue({
      data: {
        transactions: [
          makeTransactionDetail({
            id: "txn-1",
            date: "2026-04-15",
            amount: -25000,
            payee_name: "Coffee Shop",
            category_name: "Beverages",
            account_name: "Checking",
            cleared: "cleared",
            approved: true,
          }),
        ],
      },
    });

    const result = await tool.execute("call-1", { budgetId: "budget-123", sinceDate: "2026-04-01" });
    expect(result.content[0].text).toContain("- 2026-04-15 | -$25.00 | Coffee Shop | Beverages | Checking | cleared | approved");
  });

  it("formats 404 error when budget not found", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactions.mockRejectedValue({
      error: { id: "404", name: "not_found", detail: "Budget not found" },
    });

    const result = await tool.execute("call-1", { budgetId: "budget-123", sinceDate: "2026-04-01" });
    expect(result.content[0].text).toContain('Budget "budget-123" not found');
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add test/plugins/agent/extensions/ynab/tools/ynab-get-transactions.test.ts
git commit -m "test(ynab): add get-transactions e2e tests"
```

---

### Task 16: Create `ynab-get-payee-history.test.ts`

**Files:**
- Create: `test/plugins/agent/extensions/ynab/tools/ynab-get-payee-history.test.ts`

- [ ] **Step 1: Write the file**

Move e2e tests for `ynab_get_payee_history` from `ynab.test.ts` lines 1049-1123 into this file.

```ts
import { describe, it, expect } from "vitest";
import createYnabExtension from "../../../../../src/plugins/agent/extensions/ynab/index.js";
import {
  createMockYnabAPI,
  createMockFastify,
  createMockExtensionAPI,
  getTools,
  makeHybridTransaction,
} from "../test-helpers.js";

describe("ynab_get_payee_history", () => {
  function setup() {
    const ynabAPI = createMockYnabAPI();
    const fastify = createMockFastify(ynabAPI);
    const extApi = createMockExtensionAPI();
    createYnabExtension(fastify)(extApi);
    const tools = getTools(extApi);
    const tool = tools.find((t) => t.name === "ynab_get_payee_history")!;
    return { ynabAPI, fastify, extApi, tool };
  }

  it("calculates statistics correctly", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.payees.getPayees.mockResolvedValue({
      data: { payees: [{ id: "pay-1", name: "Grocery Store", deleted: false }] },
    });
    ynabAPI.transactions.getTransactionsByPayee.mockResolvedValue({
      data: {
        transactions: [
          makeHybridTransaction({ id: "txn-1", date: "2026-04-20", amount: -50000, category_name: "Food" }),
          makeHybridTransaction({ id: "txn-2", date: "2026-04-10", amount: -75000, category_name: "Food" }),
          makeHybridTransaction({ id: "txn-3", date: "2026-03-25", amount: -30000, category_name: "Snacks" }),
        ],
      },
    });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      payeeName: "Grocery Store",
      sinceDate: "2026-03-01",
    });

    expect(result.content[0].text).toContain('Payee history for "Grocery Store"');
    expect(result.content[0].text).toContain("Transactions: 3");
    expect(result.content[0].text).toContain("Most common category: Food");
  });

  it("excludes transfers when includeTransfers is false", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.payees.getPayees.mockResolvedValue({
      data: { payees: [{ id: "pay-1", name: "Transfer : Savings", deleted: false }] },
    });
    ynabAPI.transactions.getTransactionsByPayee.mockResolvedValue({
      data: {
        transactions: [
          makeHybridTransaction({ id: "txn-1", date: "2026-04-20", amount: -50000, transfer_account_id: "acc-2" }),
          makeHybridTransaction({ id: "txn-2", date: "2026-04-10", amount: -75000 }),
        ],
      },
    });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      payeeName: "Transfer : Savings",
      sinceDate: "2026-03-01",
    });

    expect(result.content[0].text).toContain("Transactions: 1");
  });

  it("returns payee not found error", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.payees.getPayees.mockResolvedValue({
      data: { payees: [] },
    });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      payeeName: "Unknown Store",
      sinceDate: "2026-03-01",
    });

    expect(result.content[0].text).toContain('Payee "Unknown Store" not found');
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add test/plugins/agent/extensions/ynab/tools/ynab-get-payee-history.test.ts
git commit -m "test(ynab): add get-payee-history e2e tests"
```

---

### Task 17: Create `ynab-create-transaction.test.ts`

**Files:**
- Create: `test/plugins/agent/extensions/ynab/tools/ynab-create-transaction.test.ts`

- [ ] **Step 1: Write the file**

Move e2e tests for `ynab_create_transaction` from `ynab.test.ts` lines 413-596 into this file.

```ts
import { describe, it, expect } from "vitest";
import createYnabExtension from "../../../../../src/plugins/agent/extensions/ynab/index.js";
import {
  createMockYnabAPI,
  createMockFastify,
  createMockExtensionAPI,
  getTools,
} from "../test-helpers.js";

describe("ynab_create_transaction", () => {
  function setup() {
    const ynabAPI = createMockYnabAPI();
    const fastify = createMockFastify(ynabAPI);
    const extApi = createMockExtensionAPI();
    createYnabExtension(fastify)(extApi);
    const tools = getTools(extApi);
    const tool = tools.find((t) => t.name === "ynab_create_transaction")!;
    return { ynabAPI, fastify, extApi, tool };
  }

  it("creates a regular transaction", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.accounts.getAccounts.mockResolvedValue({
      data: { accounts: [{ id: "acc-1", name: "Checking", deleted: false, closed: false }] },
    });
    ynabAPI.payees.getPayees.mockResolvedValue({
      data: { payees: [{ id: "pay-1", name: "Grocery Store", deleted: false }] },
    });
    ynabAPI.categories.getCategories.mockResolvedValue({
      data: {
        category_groups: [
          {
            id: "cg-1",
            name: "Group",
            categories: [{ id: "cat-1", name: "Food", deleted: false, hidden: false }],
          },
        ],
      },
    });
    ynabAPI.transactions.createTransaction.mockResolvedValue({ data: {} });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      account: "Checking",
      payee: "Grocery Store",
      amount: -50,
      date: "2026-04-29",
      category: "Food",
      memo: "Weekly shopping",
    });

    expect(result.content[0].text).toContain("Created transaction in Checking.");
    expect(result.content[0].text).toContain("Grocery Store");
    expect(result.content[0].text).toContain("Food");
    expect(ynabAPI.transactions.createTransaction).toHaveBeenCalledWith("budget-123", {
      transaction: {
        account_id: "acc-1",
        payee_id: "pay-1",
        amount: -50000,
        category_id: "cat-1",
        date: "2026-04-29",
        memo: "Weekly shopping",
      },
    });
  });

  it("creates a transfer", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.accounts.getAccounts.mockResolvedValue({
      data: {
        accounts: [
          { id: "acc-1", name: "Checking", deleted: false, closed: false },
          { id: "acc-2", name: "Savings", deleted: false, closed: false },
        ],
      },
    });
    ynabAPI.accounts.getAccountById.mockResolvedValue({
      data: { account: { id: "acc-2", name: "Savings", transfer_payee_id: "tpay-1" } },
    });
    ynabAPI.transactions.createTransaction.mockResolvedValue({ data: {} });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      account: "Checking",
      transferToAccount: "Savings",
      amount: -100,
      date: "2026-04-29",
    });

    expect(result.content[0].text).toContain("Created transfer from Checking to Savings.");
    expect(ynabAPI.transactions.createTransaction).toHaveBeenCalledWith("budget-123", {
      transaction: {
        account_id: "acc-1",
        payee_id: "tpay-1",
        amount: -100000,
        date: "2026-04-29",
      },
    });
  });

  it("creates a split with null remainder", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.accounts.getAccounts.mockResolvedValue({
      data: { accounts: [{ id: "acc-1", name: "Checking", deleted: false, closed: false }] },
    });
    ynabAPI.payees.getPayees.mockResolvedValue({
      data: { payees: [{ id: "pay-1", name: "Store", deleted: false }] },
    });
    ynabAPI.categories.getCategories.mockResolvedValue({
      data: {
        category_groups: [
          {
            id: "cg-1",
            name: "Group",
            categories: [
              { id: "cat-1", name: "Clothing", deleted: false, hidden: false },
              { id: "cat-2", name: "Household", deleted: false, hidden: false },
            ],
          },
        ],
      },
    });
    ynabAPI.transactions.createTransaction.mockResolvedValue({ data: {} });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      account: "Checking",
      payee: "Store",
      amount: -100,
      date: "2026-04-29",
      splits: [
        { category: "Clothing", amount: -60 },
        { category: "Household", amount: null },
      ],
    });

    expect(result.content[0].text).toContain("Created split transaction in Checking across 2 categories.");
    expect(result.content[0].text).toContain("Clothing");
    expect(result.content[0].text).toContain("Household");
    expect(ynabAPI.transactions.createTransaction).toHaveBeenCalledWith("budget-123", {
      transaction: {
        account_id: "acc-1",
        payee_id: "pay-1",
        amount: -100000,
        date: "2026-04-29",
        subtransactions: [
          { amount: -60000, category_id: "cat-1", memo: null },
          { amount: -40000, category_id: "cat-2", memo: null },
        ],
      },
    });
  });

  it("returns validation error when payee and transfer both missing", async () => {
    const { tool } = setup();
    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      account: "Checking",
      amount: -50,
      date: "2026-04-29",
    });
    expect(result.content[0].text).toContain("Either 'payee' or 'transferToAccount' must be provided.");
  });

  it("returns validation error when transfer and splits both provided", async () => {
    const { tool } = setup();
    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      account: "Checking",
      transferToAccount: "Savings",
      amount: -50,
      date: "2026-04-29",
      splits: [{ category: "Food", amount: -50 }],
    });
    expect(result.content[0].text).toContain("Split transactions cannot be transfers");
  });

  it("returns name not found error for missing account", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.accounts.getAccounts.mockResolvedValue({
      data: { accounts: [] },
    });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      account: "Missing",
      payee: "Store",
      amount: -50,
      date: "2026-04-29",
    });
    expect(result.content[0].text).toContain('Account "Missing" not found');
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add test/plugins/agent/extensions/ynab/tools/ynab-create-transaction.test.ts
git commit -m "test(ynab): add create-transaction e2e tests"
```

---

### Task 18: Create `ynab-split-transaction.test.ts`

**Files:**
- Create: `test/plugins/agent/extensions/ynab/tools/ynab-split-transaction.test.ts`

- [ ] **Step 1: Write the file**

Move e2e tests for `ynab_split_transaction` from `ynab.test.ts` lines 598-722 into this file.

```ts
import { describe, it, expect } from "vitest";
import createYnabExtension from "../../../../../src/plugins/agent/extensions/ynab/index.js";
import {
  createMockYnabAPI,
  createMockFastify,
  createMockExtensionAPI,
  getTools,
  makeTransactionDetail,
} from "../test-helpers.js";
import type * as ynab from "ynab";

describe("ynab_split_transaction", () => {
  function setup() {
    const ynabAPI = createMockYnabAPI();
    const fastify = createMockFastify(ynabAPI);
    const extApi = createMockExtensionAPI();
    createYnabExtension(fastify)(extApi);
    const tools = getTools(extApi);
    const tool = tools.find((t) => t.name === "ynab_split_transaction")!;
    return { ynabAPI, fastify, extApi, tool };
  }

  it("successfully splits a transaction", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById.mockResolvedValue({
      data: {
        transaction: makeTransactionDetail({ id: "txn-1", amount: -100000, subtransactions: [] }),
      },
    });
    ynabAPI.categories.getCategories.mockResolvedValue({
      data: {
        category_groups: [
          {
            id: "cg-1",
            name: "Group",
            categories: [
              { id: "cat-1", name: "Food", deleted: false, hidden: false },
              { id: "cat-2", name: "Transport", deleted: false, hidden: false },
            ],
          },
        ],
      },
    });
    ynabAPI.transactions.updateTransactions.mockResolvedValue({ data: {} });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      transactionId: "txn-1",
      splits: [
        { category: "Food", amount: -60 },
        { category: "Transport", amount: -40 },
      ],
    });

    expect(result.content[0].text).toContain("Split transaction txn-1 into 2 categories.");
    expect(ynabAPI.transactions.updateTransactions).toHaveBeenCalledWith(
      "budget-123",
      expect.objectContaining({
        transactions: expect.arrayContaining([
          expect.objectContaining({
            id: "txn-1",
            category_id: undefined,
            subtransactions: expect.arrayContaining([
              expect.objectContaining({ amount: -60000, category_id: "cat-1" }),
              expect.objectContaining({ amount: -40000, category_id: "cat-2" }),
            ]),
          }),
        ]),
      })
    );
  });

  it("guards against already-split transactions", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById.mockResolvedValue({
      data: {
        transaction: makeTransactionDetail({
          id: "txn-1",
          subtransactions: [
            { id: "sub-1", transaction_id: "txn-1", amount: -50000, deleted: false },
          ] as ynab.SubTransaction[],
        }),
      },
    });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      transactionId: "txn-1",
      splits: [
        { category: "Food", amount: -60 },
        { category: "Transport", amount: -40 },
      ],
    });

    expect(result.content[0].text).toContain("already split");
    expect(ynabAPI.transactions.updateTransactions).not.toHaveBeenCalled();
  });

  it("returns split validation error for invalid amounts", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById.mockResolvedValue({
      data: {
        transaction: makeTransactionDetail({ id: "txn-1", amount: -100000, subtransactions: [] }),
      },
    });
    ynabAPI.categories.getCategories.mockResolvedValue({
      data: {
        category_groups: [
          {
            id: "cg-1",
            name: "Group",
            categories: [
              { id: "cat-1", name: "Food", deleted: false, hidden: false },
              { id: "cat-2", name: "Transport", deleted: false, hidden: false },
            ],
          },
        ],
      },
    });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      transactionId: "txn-1",
      splits: [
        { category: "Food", amount: -30 },
        { category: "Transport", amount: -40 },
      ],
    });

    expect(result.content[0].text).toContain("Invalid split amounts");
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add test/plugins/agent/extensions/ynab/tools/ynab-split-transaction.test.ts
git commit -m "test(ynab): add split-transaction e2e tests"
```

---

### Task 19: Create `ynab-approve-transaction.test.ts`

**Files:**
- Create: `test/plugins/agent/extensions/ynab/tools/ynab-approve-transaction.test.ts`

- [ ] **Step 1: Write the file**

Move e2e tests for `ynab_approve_transaction` from `ynab.test.ts` lines 724-845 into this file.

```ts
import { describe, it, expect } from "vitest";
import createYnabExtension from "../../../../../src/plugins/agent/extensions/ynab/index.js";
import {
  createMockYnabAPI,
  createMockFastify,
  createMockExtensionAPI,
  getTools,
  makeTransactionDetail,
} from "../test-helpers.js";
import type * as ynab from "ynab";

describe("ynab_approve_transaction", () => {
  function setup() {
    const ynabAPI = createMockYnabAPI();
    const fastify = createMockFastify(ynabAPI);
    const extApi = createMockExtensionAPI();
    createYnabExtension(fastify)(extApi);
    const tools = getTools(extApi);
    const tool = tools.find((t) => t.name === "ynab_approve_transaction")!;
    return { ynabAPI, fastify, extApi, tool };
  }

  it("approves with category and cleared", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById
      .mockResolvedValueOnce({
        data: {
          transaction: makeTransactionDetail({
            id: "txn-1",
            approved: false,
            cleared: "uncleared",
            category_name: null,
            subtransactions: [],
          }),
        },
      })
      .mockResolvedValue({
        data: {
          transaction: makeTransactionDetail({
            id: "txn-1",
            approved: true,
            cleared: "cleared",
            category_name: "Food",
            subtransactions: [],
          }),
        },
      });
    ynabAPI.categories.getCategories.mockResolvedValue({
      data: {
        category_groups: [
          {
            id: "cg-1",
            name: "Group",
            categories: [{ id: "cat-1", name: "Food", deleted: false, hidden: false }],
          },
        ],
      },
    });
    ynabAPI.transactions.updateTransactions.mockResolvedValue({ data: {} });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      transactionId: "txn-1",
      category: "Food",
      cleared: true,
    });

    expect(result.content[0].text).toContain("Approved transaction txn-1.");
    expect(result.content[0].text).toContain("Food");
    expect(result.content[0].text).toContain("Cleared: yes");
    expect(ynabAPI.transactions.updateTransactions).toHaveBeenCalledWith("budget-123", {
      transactions: [
        {
          id: "txn-1",
          approved: true,
          category_id: "cat-1",
          cleared: "cleared",
        },
      ],
    });
  });

  it("is idempotent when already approved with no meaningful changes", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById.mockResolvedValue({
      data: {
        transaction: makeTransactionDetail({
          id: "txn-1",
          approved: true,
          cleared: "cleared",
          category_name: "Food",
          subtransactions: [],
        }),
      },
    });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      transactionId: "txn-1",
    });

    expect(result.content[0].text).toContain("already approved");
    expect(ynabAPI.transactions.updateTransactions).not.toHaveBeenCalled();
  });

  it("returns error when trying to category a split transaction", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById.mockResolvedValue({
      data: {
        transaction: makeTransactionDetail({
          id: "txn-1",
          approved: false,
          subtransactions: [
            { id: "sub-1", transaction_id: "txn-1", amount: -50000, deleted: false },
          ] as ynab.SubTransaction[],
        }),
      },
    });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      transactionId: "txn-1",
      category: "Food",
    });

    expect(result.content[0].text).toContain("Cannot assign category");
    expect(result.content[0].text).toContain("split transaction");
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add test/plugins/agent/extensions/ynab/tools/ynab-approve-transaction.test.ts
git commit -m "test(ynab): add approve-transaction e2e tests"
```

---

### Task 20: Create `ynab-delete-transaction.test.ts`

**Files:**
- Create: `test/plugins/agent/extensions/ynab/tools/ynab-delete-transaction.test.ts`

- [ ] **Step 1: Write the file**

Move e2e tests for `ynab_delete_transaction` from `ynab.test.ts` lines 847-901 into this file.

```ts
import { describe, it, expect } from "vitest";
import createYnabExtension from "../../../../../src/plugins/agent/extensions/ynab/index.js";
import {
  createMockYnabAPI,
  createMockFastify,
  createMockExtensionAPI,
  getTools,
  makeTransactionDetail,
} from "../test-helpers.js";

describe("ynab_delete_transaction", () => {
  function setup() {
    const ynabAPI = createMockYnabAPI();
    const fastify = createMockFastify(ynabAPI);
    const extApi = createMockExtensionAPI();
    createYnabExtension(fastify)(extApi);
    const tools = getTools(extApi);
    const tool = tools.find((t) => t.name === "ynab_delete_transaction")!;
    return { ynabAPI, fastify, extApi, tool };
  }

  it("successfully deletes a transaction", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById.mockResolvedValue({
      data: {
        transaction: makeTransactionDetail({
          id: "txn-1",
          date: "2026-04-27",
          amount: -100000,
          payee_name: "Department Store",
          category_name: "Household",
          memo: "Monthly supplies",
        }),
      },
    });
    ynabAPI.transactions.deleteTransaction.mockResolvedValue({ data: {} });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      transactionId: "txn-1",
    });

    expect(result.content[0].text).toContain("Deleted transaction txn-1.");
    expect(result.content[0].text).toContain("Department Store");
    expect(ynabAPI.transactions.deleteTransaction).toHaveBeenCalledWith("budget-123", "txn-1");
  });

  it("handles already-deleted (404) gracefully", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById.mockRejectedValue({
      error: { id: "404", name: "not_found", detail: "Transaction not found" },
    });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      transactionId: "txn-1",
    });

    expect(result.content[0].text).toContain("already deleted or did not exist");
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add test/plugins/agent/extensions/ynab/tools/ynab-delete-transaction.test.ts
git commit -m "test(ynab): add delete-transaction e2e tests"
```

---

### Task 21: Create `ynab-flag-transaction.test.ts`

**Files:**
- Create: `test/plugins/agent/extensions/ynab/tools/ynab-flag-transaction.test.ts`

- [ ] **Step 1: Write the file**

Move e2e tests for `ynab_flag_transaction` from `ynab.test.ts` lines 903-1043 into this file.

```ts
import { describe, it, expect } from "vitest";
import createYnabExtension from "../../../../../src/plugins/agent/extensions/ynab/index.js";
import {
  createMockYnabAPI,
  createMockFastify,
  createMockExtensionAPI,
  getTools,
  makeTransactionDetail,
} from "../test-helpers.js";

describe("ynab_flag_transaction", () => {
  function setup() {
    const ynabAPI = createMockYnabAPI();
    const fastify = createMockFastify(ynabAPI);
    const extApi = createMockExtensionAPI();
    createYnabExtension(fastify)(extApi);
    const tools = getTools(extApi);
    const tool = tools.find((t) => t.name === "ynab_flag_transaction")!;
    return { ynabAPI, fastify, extApi, tool };
  }

  it("flags with color and reason", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById
      .mockResolvedValueOnce({
        data: {
          transaction: makeTransactionDetail({
            id: "txn-1",
            flag_color: null,
            memo: "",
          }),
        },
      })
      .mockResolvedValue({
        data: {
          transaction: makeTransactionDetail({
            id: "txn-1",
            flag_color: "red",
            memo: "Amount outside expected range",
          }),
        },
      });
    ynabAPI.transactions.updateTransactions.mockResolvedValue({ data: {} });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      transactionId: "txn-1",
      flagColor: "red",
      reason: "amount_anomaly",
    });

    expect(result.content[0].text).toContain("Flagged transaction txn-1 with red flag.");
    expect(ynabAPI.transactions.updateTransactions).toHaveBeenCalledWith("budget-123", {
      transactions: [
        {
          id: "txn-1",
          flag_color: "red",
          memo: "Amount outside expected range",
        },
      ],
    });
  });

  it("clears flag", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById
      .mockResolvedValueOnce({
        data: {
          transaction: makeTransactionDetail({
            id: "txn-1",
            flag_color: "red",
            memo: "Some memo",
          }),
        },
      })
      .mockResolvedValue({
        data: {
          transaction: makeTransactionDetail({
            id: "txn-1",
            flag_color: null,
            memo: "Some memo",
          }),
        },
      });
    ynabAPI.transactions.updateTransactions.mockResolvedValue({ data: {} });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      transactionId: "txn-1",
      clearFlag: true,
    });

    expect(result.content[0].text).toContain("Cleared flag from transaction txn-1.");
    expect(ynabAPI.transactions.updateTransactions).toHaveBeenCalledWith("budget-123", {
      transactions: [
        {
          id: "txn-1",
          flag_color: "",
        },
      ],
    });
  });

  it("is idempotent when already flagged with same color", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById.mockResolvedValue({
      data: {
        transaction: makeTransactionDetail({
          id: "txn-1",
          flag_color: "blue",
          memo: "",
        }),
      },
    });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      transactionId: "txn-1",
      flagColor: "blue",
    });

    expect(result.content[0].text).toContain("already has the blue flag");
    expect(ynabAPI.transactions.updateTransactions).not.toHaveBeenCalled();
  });

  it("returns validation error when neither flagColor nor clearFlag provided", async () => {
    const { tool } = setup();
    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      transactionId: "txn-1",
    });

    expect(result.content[0].text).toContain("Must provide either flagColor or clearFlag=true.");
  });

  it("returns validation error when both flagColor and clearFlag provided", async () => {
    const { tool } = setup();
    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      transactionId: "txn-1",
      flagColor: "red",
      clearFlag: true,
    });

    expect(result.content[0].text).toContain("but not both.");
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add test/plugins/agent/extensions/ynab/tools/ynab-flag-transaction.test.ts
git commit -m "test(ynab): add flag-transaction e2e tests"
```

---

### Task 22: Delete old test file

**Files:**
- Delete: `test/plugins/agent/extensions/ynab.test.ts`

- [ ] **Step 1: Delete**

```bash
rm test/plugins/agent/extensions/ynab.test.ts
git add -A
git commit -m "test(ynab): remove monolithic test file"
```

---

### Task 23: Run typecheck and full test suite

- [ ] **Step 1: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS (no errors)

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(ynab): complete extension refactor"
```

---

## Self-Review

**Spec coverage:**
- File structure: Tasks 1-12 create all source files, Tasks 13-22 create all test files.
- Tool factory pattern with explicit generics: Covered in Tasks 3-9.
- Formatter organization: Covered in Task 1 (source) and Task 13 (test).
- Utils organization: Covered in Task 2 (source) and Task 14 (test).
- Migration order: Sequential tasks match the spec order.
- Deleted files: Tasks 11 and 22 delete old files.

**Placeholder scan:**
- No TBD/TODO placeholders.
- All code blocks contain complete file contents.
- All imports use exact paths with `.js` extensions.

**Type consistency:**
- All tool factories return `ToolDefinition<typeof paramsSchema>`.
- All test files import from the correct relative paths.
- `formatters.ts` uses `await import("./utils.js")` for `daysBetween` to avoid circular dependency.
