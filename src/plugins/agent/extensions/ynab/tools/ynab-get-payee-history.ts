import type { FastifyInstance } from "fastify";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
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
