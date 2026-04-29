import type { ExtensionAPI, ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type { FastifyInstance } from "fastify";
import { Type } from "typebox";
import type * as ynab from "ynab";
import currency from "currency.js";
import {
  buildPayeeStats,
  daysBetween,
  formatMilliunits,
  getDefaultPayeeSinceDate,
  getDefaultSinceDate,
  getYnabErrorMessage,
  isYnabNotFoundError,
  resolveAccountId,
  resolveCategoryId,
  resolvePayeeId,
  validateAndResolveSplits,
} from "./ynab-utils.js";

const FLAG_REASON_TEMPLATES: Record<string, string> = {
  amount_anomaly: "Amount outside expected range",
  new_payee: "No payee history available",
  category_ambiguous: "No clear category match",
  possible_duplicate: "Possible duplicate transaction",
  partial_match: "Partial match to pre-entry",
  manual_review: "Needs manual review",
};

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

export default function createYnabExtension(fastify: FastifyInstance): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "ynab_get_transactions",
      label: "Get YNAB Transactions",
      description:
        "Fetches transactions from a YNAB budget. Use unapproved=true to find bank imports awaiting review. Use uncleared=true to find manual entries not yet matched.",
      parameters: Type.Object({
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
      }),
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
    });

    pi.registerTool({
      name: "ynab_get_payee_history",
      label: "Get YNAB Payee History",
      description:
        "Fetches historical transactions for a payee and computes spending statistics (average, median, min/max, std deviation, frequency) to help decide whether a transaction should be auto-approved.",
      parameters: Type.Object({
        budgetId: Type.String({ description: "The UUID of the YNAB budget" }),
        payeeName: Type.String({ description: "Exact payee name as it appears in YNAB" }),
        sinceDate: Type.Optional(
          Type.String({ description: "Start date (YYYY-MM-DD). Defaults to 6 months ago." })
        ),
        includeTransfers: Type.Optional(
          Type.Boolean({ description: "Whether to include transfer transactions. Defaults to false." })
        ),
      }),
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
    });

    pi.registerTool({
      name: "ynab_create_transaction",
      label: "Create YNAB Transaction",
      description:
        "Creates a new transaction in a YNAB budget. Supports regular transactions, transfers between accounts, and split transactions.",
      parameters: Type.Object({
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
      }),
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

            const splitLines: SplitLine[] = params.splits.map((split, i) => ({
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
    });

    pi.registerTool({
      name: "ynab_split_transaction",
      label: "Split YNAB Transaction",
      description:
        "Splits an existing YNAB transaction into multiple categories. The transaction must not already be split.",
      parameters: Type.Object({
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
      }),
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

          const splitLines: SplitLine[] = params.splits.map((split, i) => ({
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
    });

    pi.registerTool({
      name: "ynab_approve_transaction",
      label: "Approve YNAB Transaction",
      description:
        "Approves a transaction in YNAB and optionally updates its category, memo, or cleared status.",
      parameters: Type.Object({
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
      }),
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
    });

    pi.registerTool({
      name: "ynab_delete_transaction",
      label: "Delete YNAB Transaction",
      description: "Deletes a transaction from a YNAB budget.",
      parameters: Type.Object({
        budgetId: Type.String({ description: "The UUID of the YNAB budget" }),
        transactionId: Type.String({ description: "The ID of the transaction to delete" }),
      }),
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
    });

    pi.registerTool({
      name: "ynab_flag_transaction",
      label: "Flag YNAB Transaction",
      description:
        "Sets or clears a flag color on a YNAB transaction. Optionally prepends a reason template to the memo.",
      parameters: Type.Object({
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
      }),
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
    });
  };
}
