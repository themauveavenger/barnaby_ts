import { describe, it, expect } from 'vitest';
import createYnabExtension from '../../../../../../src/plugins/agent/extensions/ynab/index.js';
import {
  createMockYnabAPI,
  createMockFastify,
  createMockExtensionAPI,
  getTools,
  makeTransactionDetail
} from '../test-helpers.js';
import type * as ynab from 'ynab';

describe('ynab_split_transaction', () => {
  function setup() {
    const ynabAPI = createMockYnabAPI();
    const fastify = createMockFastify(ynabAPI);
    const extApi = createMockExtensionAPI();
    createYnabExtension(fastify)(extApi);
    const tools = getTools(extApi);
    const tool = tools.find(t => t.name === 'ynab_split_transaction')!;
    return { ynabAPI, fastify, extApi, tool };
  }

  it('successfully splits a transaction', async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById.mockResolvedValue({
      data: {
        transaction: makeTransactionDetail({ id: 'txn-1', amount: -100000, subtransactions: [] })
      }
    });
    ynabAPI.categories.getCategories.mockResolvedValue({
      data: {
        category_groups: [
          {
            id: 'cg-1',
            name: 'Group',
            categories: [
              { id: 'cat-1', name: 'Food', deleted: false, hidden: false },
              { id: 'cat-2', name: 'Transport', deleted: false, hidden: false }
            ]
          }
        ]
      }
    });
    ynabAPI.transactions.updateTransactions.mockResolvedValue({ data: {} });

    const result = await tool.execute('call-1', {
      budgetId: 'budget-123',
      transactionId: 'txn-1',
      splits: [
        { category: 'Food', amount: -60 },
        { category: 'Transport', amount: -40 }
      ]
    });

    expect(result.content[0].text).toContain('Split transaction txn-1 into 2 categories.');
    expect(ynabAPI.transactions.updateTransactions).toHaveBeenCalledWith(
      'budget-123',
      expect.objectContaining({
        transactions: expect.arrayContaining([
          expect.objectContaining({
            id: 'txn-1',
            category_id: undefined,
            subtransactions: expect.arrayContaining([
              expect.objectContaining({ amount: -60000, category_id: 'cat-1' }),
              expect.objectContaining({ amount: -40000, category_id: 'cat-2' })
            ])
          })
        ])
      })
    );
  });

  it('guards against already-split transactions', async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById.mockResolvedValue({
      data: {
        transaction: makeTransactionDetail({
          id: 'txn-1',
          subtransactions: [
            { id: 'sub-1', transaction_id: 'txn-1', amount: -50000, deleted: false }
          ] as ynab.SubTransaction[]
        })
      }
    });

    const result = await tool.execute('call-1', {
      budgetId: 'budget-123',
      transactionId: 'txn-1',
      splits: [
        { category: 'Food', amount: -60 },
        { category: 'Transport', amount: -40 }
      ]
    });

    expect(result.content[0].text).toContain('already split');
    expect(ynabAPI.transactions.updateTransactions).not.toHaveBeenCalled();
  });

  it('returns split validation error for invalid amounts', async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById.mockResolvedValue({
      data: {
        transaction: makeTransactionDetail({ id: 'txn-1', amount: -100000, subtransactions: [] })
      }
    });
    ynabAPI.categories.getCategories.mockResolvedValue({
      data: {
        category_groups: [
          {
            id: 'cg-1',
            name: 'Group',
            categories: [
              { id: 'cat-1', name: 'Food', deleted: false, hidden: false },
              { id: 'cat-2', name: 'Transport', deleted: false, hidden: false }
            ]
          }
        ]
      }
    });

    const result = await tool.execute('call-1', {
      budgetId: 'budget-123',
      transactionId: 'txn-1',
      splits: [
        { category: 'Food', amount: -30 },
        { category: 'Transport', amount: -40 }
      ]
    });

    expect(result.content[0].text).toContain('Invalid split amounts');
  });
});
