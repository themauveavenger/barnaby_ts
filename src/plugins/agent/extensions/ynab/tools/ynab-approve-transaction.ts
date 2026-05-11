import type { FastifyInstance } from "fastify";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type * as ynab from "ynab";
import { formatMilliunits, getYnabErrorMessage, isYnabNotFoundError, resolveCategoryId, } from "../utils.js";
import { formatAlreadyApprovedResponse, formatApproveTransactionResponse } from "../formatters.js";

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

export default function createTool({ ynabClient: { api: ynabAPI } }: FastifyInstance): ToolDefinition<typeof paramsSchema> {
  return {
    name: "ynab_approve_transaction",
    label: "Approve YNAB Transaction",
    description:
      "Approves a transaction in YNAB and optionally updates its category, memo, or cleared status.",
    parameters: paramsSchema,
    async execute(_toolCallId, params) {
      try {
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
