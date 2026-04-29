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
  };
}
