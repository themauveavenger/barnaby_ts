import type { FastifyInstance } from 'fastify';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type * as ynab from 'ynab';
import { getYnabErrorMessage, isYnabNotFoundError } from '../utils.js';
import { formatFlagTransactionResponse, formatAlreadyFlaggedResponse } from '../formatters.js';

const FLAG_REASON_TEMPLATES: Record<string, string> = {
  amount_anomaly: 'Amount outside expected range',
  new_payee: 'No payee history available',
  category_ambiguous: 'No clear category match',
  possible_duplicate: 'Possible duplicate transaction',
  partial_match: 'Partial match to pre-entry',
  manual_review: 'Needs manual review'
};

const paramsSchema = Type.Object({
  budgetId: Type.String({ description: 'The UUID of the YNAB budget' }),
  transactionId: Type.String({ description: 'The ID of the transaction to flag' }),
  flagColor: Type.Optional(
    Type.Union(
      [
        Type.Literal('red'),
        Type.Literal('orange'),
        Type.Literal('yellow'),
        Type.Literal('green'),
        Type.Literal('blue'),
        Type.Literal('purple')
      ],
      { description: 'Flag color to set. Required unless clearFlag is true.' }
    )
  ),
  clearFlag: Type.Optional(
    Type.Boolean({ description: 'When true, removes the flag color. Mutually exclusive with flagColor.' })
  ),
  reason: Type.Optional(
    Type.Enum(
      {
        amount_anomaly: 'amount_anomaly',
        new_payee: 'new_payee',
        category_ambiguous: 'category_ambiguous',
        possible_duplicate: 'possible_duplicate',
        partial_match: 'partial_match',
        manual_review: 'manual_review'
      },
      { description: 'Reason for flagging. Prepends a template to the memo.' }
    )
  )
});

export default function createTool(fastify: FastifyInstance): ToolDefinition<typeof paramsSchema> {
  return {
    name: 'ynab_flag_transaction',
    label: 'Flag YNAB Transaction',
    description:
      'Sets or clears a flag color on a YNAB transaction. Optionally prepends a reason template to the memo.',
    parameters: paramsSchema,
    async execute(_toolCallId, params) {
      if (!params.flagColor && !params.clearFlag) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Error: Invalid flag input. Must provide either flagColor or clearFlag=true.'
            }
          ],
          details: {}
        };
      }
      if (params.flagColor && params.clearFlag) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Error: Invalid flag input. Must provide either flagColor or clearFlag=true, but not both.'
            }
          ],
          details: {}
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
        }
        catch (error) {
          if (isYnabNotFoundError(error)) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Error: Transaction "${params.transactionId}" not found in budget.`
                }
              ],
              details: {}
            };
          }
          throw error;
        }

        const targetFlagColor: ynab.TransactionFlagColor = params.clearFlag
          ? ''
          : params.flagColor!;

        let newMemo: string | undefined = undefined;
        if (params.reason) {
          const template = FLAG_REASON_TEMPLATES[params.reason];
          const existingMemo = existingTransaction.memo ?? '';
          if (!existingMemo.startsWith(template)) {
            newMemo = existingMemo ? `${template} | ${existingMemo}` : template;
          }
        }

        const memoAlreadyMatches
          = newMemo === undefined || newMemo === (existingTransaction.memo ?? '');
        const flagAlreadyMatches
          = existingTransaction.flag_color === targetFlagColor
            || (targetFlagColor === '' && !existingTransaction.flag_color);

        if (memoAlreadyMatches && flagAlreadyMatches) {
          const text = formatAlreadyFlaggedResponse(
            params.transactionId,
            targetFlagColor || null
          );
          return {
            content: [{ type: 'text' as const, text }],
            details: {}
          };
        }

        const payload: ynab.SaveTransactionWithIdOrImportId = {
          id: params.transactionId,
          flag_color: targetFlagColor
        };

        if (newMemo !== undefined) {
          payload.memo = newMemo;
        }

        await ynabAPI.transactions.updateTransactions(params.budgetId, {
          transactions: [payload]
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
          content: [{ type: 'text' as const, text }],
          details: {}
        };
      }
      catch (error) {
        const message = isYnabNotFoundError(error)
          ? `Budget "${params.budgetId}" not found. Verify the budget ID.`
          : getYnabErrorMessage(error);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: Failed to flag transaction in YNAB.\n${message}`
            }
          ],
          details: {}
        };
      }
    }
  };
}
