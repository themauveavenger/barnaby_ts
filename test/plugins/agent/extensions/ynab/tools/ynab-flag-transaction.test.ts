import { describe, it, expect } from 'vitest';
import createYnabExtension from '../../../../../../src/plugins/agent/extensions/ynab/index.js';
import {
  createMockYnabAPI,
  createMockFastify,
  createMockExtensionAPI,
  getTools,
  makeTransactionDetail
} from '../test-helpers.js';

describe('ynab_flag_transaction', () => {
  function setup() {
    const ynabAPI = createMockYnabAPI();
    const fastify = createMockFastify(ynabAPI);
    const extApi = createMockExtensionAPI();
    createYnabExtension(fastify)(extApi);
    const tools = getTools(extApi);
    const tool = tools.find(t => t.name === 'ynab_flag_transaction')!;
    return { ynabAPI, fastify, extApi, tool };
  }

  it('flags with color and reason', async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById
      .mockResolvedValueOnce({
        data: {
          transaction: makeTransactionDetail({
            id: 'txn-1',
            flag_color: null,
            memo: ''
          })
        }
      })
      .mockResolvedValue({
        data: {
          transaction: makeTransactionDetail({
            id: 'txn-1',
            flag_color: 'red',
            memo: 'Amount outside expected range'
          })
        }
      });
    ynabAPI.transactions.updateTransactions.mockResolvedValue({ data: {} });

    const result = await tool.execute('call-1', {
      budgetId: 'budget-123',
      transactionId: 'txn-1',
      flagColor: 'red',
      reason: 'amount_anomaly'
    });

    expect(result.content[0].text).toContain('Flagged transaction txn-1 with red flag.');
    expect(ynabAPI.transactions.updateTransactions).toHaveBeenCalledWith('budget-123', {
      transactions: [
        {
          id: 'txn-1',
          flag_color: 'red',
          memo: 'Amount outside expected range'
        }
      ]
    });
  });

  it('clears flag', async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById
      .mockResolvedValueOnce({
        data: {
          transaction: makeTransactionDetail({
            id: 'txn-1',
            flag_color: 'red',
            memo: 'Some memo'
          })
        }
      })
      .mockResolvedValue({
        data: {
          transaction: makeTransactionDetail({
            id: 'txn-1',
            flag_color: null,
            memo: 'Some memo'
          })
        }
      });
    ynabAPI.transactions.updateTransactions.mockResolvedValue({ data: {} });

    const result = await tool.execute('call-1', {
      budgetId: 'budget-123',
      transactionId: 'txn-1',
      clearFlag: true
    });

    expect(result.content[0].text).toContain('Cleared flag from transaction txn-1.');
    expect(ynabAPI.transactions.updateTransactions).toHaveBeenCalledWith('budget-123', {
      transactions: [
        {
          id: 'txn-1',
          flag_color: ''
        }
      ]
    });
  });

  it('is idempotent when already flagged with same color', async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById.mockResolvedValue({
      data: {
        transaction: makeTransactionDetail({
          id: 'txn-1',
          flag_color: 'blue',
          memo: ''
        })
      }
    });

    const result = await tool.execute('call-1', {
      budgetId: 'budget-123',
      transactionId: 'txn-1',
      flagColor: 'blue'
    });

    expect(result.content[0].text).toContain('already has the blue flag');
    expect(ynabAPI.transactions.updateTransactions).not.toHaveBeenCalled();
  });

  it('returns validation error when neither flagColor nor clearFlag provided', async () => {
    const { tool } = setup();
    const result = await tool.execute('call-1', {
      budgetId: 'budget-123',
      transactionId: 'txn-1'
    });

    expect(result.content[0].text).toContain('Must provide either flagColor or clearFlag=true.');
  });

  it('returns validation error when both flagColor and clearFlag provided', async () => {
    const { tool } = setup();
    const result = await tool.execute('call-1', {
      budgetId: 'budget-123',
      transactionId: 'txn-1',
      flagColor: 'red',
      clearFlag: true
    });

    expect(result.content[0].text).toContain('but not both.');
  });
});
