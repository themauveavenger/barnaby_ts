import type { FastifyInstance } from 'fastify';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { getDefaultSinceDate, getYnabErrorMessage, isYnabNotFoundError } from '../utils.js';
import { formatTransactionsResponse } from '../formatters.js';

const paramsSchema = Type.Object({
  budgetId: Type.String({ description: 'The UUID of the YNAB budget' }),
  sinceDate: Type.Optional(
    Type.String({ description: 'Start date (YYYY-MM-DD). Defaults to 30 days ago.' })
  ),
  unapproved: Type.Optional(
    Type.Boolean({
      description:
        'If true, return only unapproved transactions. If false, return only approved. Omit to include both.'
    })
  ),
  uncleared: Type.Optional(
    Type.Boolean({
      description:
        'If true, return only uncleared transactions. If false, return only cleared/reconciled. Omit to include both.'
    })
  )
});

export default function createTool(fastify: FastifyInstance): ToolDefinition<typeof paramsSchema> {
  return {
    name: 'ynab_get_transactions',
    label: 'Get YNAB Transactions',
    description:
      'Fetches transactions from a YNAB budget. Use unapproved=true to find bank imports awaiting review. Use uncleared=true to find manual entries not yet matched.',
    parameters: paramsSchema,
    async execute(_toolCallId, params) {
      try {
        const sinceDate = params.sinceDate ?? getDefaultSinceDate();
        const ynabAPI = fastify.ynabClient.api;
        const response = await ynabAPI.transactions.getTransactions(params.budgetId, sinceDate);
        let transactions = response.data.transactions;

        if (params.unapproved !== undefined) {
          transactions = transactions.filter(t =>
            params.unapproved ? !t.approved : t.approved
          );
        }
        if (params.uncleared !== undefined) {
          transactions = transactions.filter(t =>
            params.uncleared ? t.cleared === 'uncleared' : t.cleared !== 'uncleared'
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
              text: `Error: Failed to fetch transactions from YNAB.\n${message}`
            }
          ],
          details: {}
        };
      }
    }
  };
}
