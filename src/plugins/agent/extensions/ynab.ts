import type { ExtensionAPI, ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type { FastifyInstance } from "fastify";
import { Type } from "typebox";
import type * as ynab from "ynab";
import {
  buildPayeeStats,
  daysBetween,
  formatMilliunits,
  getDefaultPayeeSinceDate,
  getDefaultSinceDate,
  getYnabErrorMessage,
  isYnabNotFoundError,
  resolvePayeeId,
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
  };
}
