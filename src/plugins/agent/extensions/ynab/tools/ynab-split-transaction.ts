import type { FastifyInstance } from 'fastify';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import currency from 'currency.js';
import { formatMilliunits, getYnabErrorMessage, isYnabNotFoundError, validateAndResolveSplits } from '../utils.js';
import { formatSplitTransactionResponse } from '../formatters.js';

const paramsSchema = Type.Object({
  budgetId: Type.String({ description: 'The UUID of the YNAB budget' }),
  transactionId: Type.String({ description: 'The ID of the transaction to split' }),
  splits: Type.Array(
    Type.Object({
      category: Type.String({ description: 'Category name for this split' }),
      amount: Type.Union([Type.Number(), Type.Null()], { description: 'Amount in dollars, or null to calculate from remainder' }),
      memo: Type.Optional(Type.String({ description: 'Optional memo for this split' }))
    }),
    { minItems: 2, description: 'At least 2 splits to divide the transaction' }
  )
});

export default function createTool(fastify: FastifyInstance): ToolDefinition<typeof paramsSchema> {
  return {
    name: 'ynab_split_transaction',
    label: 'Split YNAB Transaction',
    description:
      'Splits an existing YNAB transaction into multiple categories. The transaction must not already be split.',
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
                type: 'text' as const,
                text: `Error: Cannot split transaction ${params.transactionId}.\nThis transaction is already split. Delete and recreate it to change splits.`
              }
            ],
            details: {}
          };
        }

        const totalAmount = currency(existingTransaction.amount / 1000);
        const splitInputs = params.splits.map(s => ({
          category: s.category,
          amount: s.amount === null ? null : currency(s.amount),
          memo: s.memo
        }));

        const result = await validateAndResolveSplits(ynabAPI, params.budgetId, totalAmount, splitInputs);
        if (result.errors.length > 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: Invalid split amounts.\n${result.errors.join('\n')}`
              }
            ],
            details: {}
          };
        }

        const subtransactions = result.subtransactions;

        await ynabAPI.transactions.updateTransactions(params.budgetId, {
          transactions: [
            {
              id: params.transactionId,
              category_id: undefined,
              subtransactions
            }
          ]
        });

        const splitLines = params.splits.map((split, i) => ({
          category: split.category,
          amount: formatMilliunits(subtransactions[i].amount)
        }));

        const text = formatSplitTransactionResponse(params.transactionId, splitLines);
        return {
          content: [{ type: 'text' as const, text }],
          details: {}
        };
      }
      catch (error) {
        const message = isYnabNotFoundError(error)
          ? `Budget "${params.budgetId}" not found or transaction "${params.transactionId}" does not exist. Verify the IDs.`
          : getYnabErrorMessage(error);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: Failed to split transaction in YNAB.\n${message}`
            }
          ],
          details: {}
        };
      }
    }
  };
}
