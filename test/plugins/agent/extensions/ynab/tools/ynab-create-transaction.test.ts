import { describe, it, expect } from 'vitest';
import createYnabExtension from '../../../../../../src/plugins/agent/extensions/ynab/index.js';
import {
  createMockYnabAPI,
  createMockFastify,
  createMockExtensionAPI,
  getTools
} from '../test-helpers.js';

describe('ynab_create_transaction', () => {
  function setup() {
    const ynabAPI = createMockYnabAPI();
    const fastify = createMockFastify(ynabAPI);
    const extApi = createMockExtensionAPI();
    createYnabExtension(fastify)(extApi);
    const tools = getTools(extApi);
    const tool = tools.find(t => t.name === 'ynab_create_transaction')!;
    return { ynabAPI, fastify, extApi, tool };
  }

  it('creates a regular transaction', async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.accounts.getAccounts.mockResolvedValue({
      data: { accounts: [{ id: 'acc-1', name: 'Checking', deleted: false, closed: false }] }
    });
    ynabAPI.payees.getPayees.mockResolvedValue({
      data: { payees: [{ id: 'pay-1', name: 'Grocery Store', deleted: false }] }
    });
    ynabAPI.categories.getCategories.mockResolvedValue({
      data: {
        category_groups: [
          {
            id: 'cg-1',
            name: 'Group',
            categories: [{ id: 'cat-1', name: 'Food', deleted: false, hidden: false }]
          }
        ]
      }
    });
    ynabAPI.transactions.createTransaction.mockResolvedValue({ data: {} });

    const result = await tool.execute('call-1', {
      budgetId: 'budget-123',
      account: 'Checking',
      payee: 'Grocery Store',
      amount: -50,
      date: '2026-04-29',
      category: 'Food',
      memo: 'Weekly shopping'
    });

    expect(result.content[0].text).toContain('Created transaction in Checking.');
    expect(result.content[0].text).toContain('Grocery Store');
    expect(result.content[0].text).toContain('Food');
    expect(ynabAPI.transactions.createTransaction).toHaveBeenCalledWith('budget-123', {
      transaction: {
        account_id: 'acc-1',
        payee_id: 'pay-1',
        amount: -50000,
        category_id: 'cat-1',
        date: '2026-04-29',
        memo: 'Weekly shopping'
      }
    });
  });

  it('creates a transfer', async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.accounts.getAccounts.mockResolvedValue({
      data: {
        accounts: [
          { id: 'acc-1', name: 'Checking', deleted: false, closed: false },
          { id: 'acc-2', name: 'Savings', deleted: false, closed: false }
        ]
      }
    });
    ynabAPI.accounts.getAccountById.mockResolvedValue({
      data: { account: { id: 'acc-2', name: 'Savings', transfer_payee_id: 'tpay-1' } }
    });
    ynabAPI.transactions.createTransaction.mockResolvedValue({ data: {} });

    const result = await tool.execute('call-1', {
      budgetId: 'budget-123',
      account: 'Checking',
      transferToAccount: 'Savings',
      amount: -100,
      date: '2026-04-29'
    });

    expect(result.content[0].text).toContain('Created transfer from Checking to Savings.');
    expect(ynabAPI.transactions.createTransaction).toHaveBeenCalledWith('budget-123', {
      transaction: {
        account_id: 'acc-1',
        payee_id: 'tpay-1',
        amount: -100000,
        date: '2026-04-29'
      }
    });
  });

  it('creates a split with null remainder', async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.accounts.getAccounts.mockResolvedValue({
      data: { accounts: [{ id: 'acc-1', name: 'Checking', deleted: false, closed: false }] }
    });
    ynabAPI.payees.getPayees.mockResolvedValue({
      data: { payees: [{ id: 'pay-1', name: 'Store', deleted: false }] }
    });
    ynabAPI.categories.getCategories.mockResolvedValue({
      data: {
        category_groups: [
          {
            id: 'cg-1',
            name: 'Group',
            categories: [
              { id: 'cat-1', name: 'Clothing', deleted: false, hidden: false },
              { id: 'cat-2', name: 'Household', deleted: false, hidden: false }
            ]
          }
        ]
      }
    });
    ynabAPI.transactions.createTransaction.mockResolvedValue({ data: {} });

    const result = await tool.execute('call-1', {
      budgetId: 'budget-123',
      account: 'Checking',
      payee: 'Store',
      amount: -100,
      date: '2026-04-29',
      splits: [
        { category: 'Clothing', amount: -60 },
        { category: 'Household', amount: null }
      ]
    });

    expect(result.content[0].text).toContain('Created split transaction in Checking across 2 categories.');
    expect(result.content[0].text).toContain('Clothing');
    expect(result.content[0].text).toContain('Household');
    expect(ynabAPI.transactions.createTransaction).toHaveBeenCalledWith('budget-123', {
      transaction: {
        account_id: 'acc-1',
        payee_id: 'pay-1',
        amount: -100000,
        date: '2026-04-29',
        subtransactions: [
          { amount: -60000, category_id: 'cat-1', memo: null },
          { amount: -40000, category_id: 'cat-2', memo: null }
        ]
      }
    });
  });

  it('returns validation error when payee and transfer both missing', async () => {
    const { tool } = setup();
    const result = await tool.execute('call-1', {
      budgetId: 'budget-123',
      account: 'Checking',
      amount: -50,
      date: '2026-04-29'
    });
    expect(result.content[0].text).toContain('Either \'payee\' or \'transferToAccount\' must be provided.');
  });

  it('returns validation error when transfer and splits both provided', async () => {
    const { tool } = setup();
    const result = await tool.execute('call-1', {
      budgetId: 'budget-123',
      account: 'Checking',
      transferToAccount: 'Savings',
      amount: -50,
      date: '2026-04-29',
      splits: [{ category: 'Food', amount: -50 }]
    });
    expect(result.content[0].text).toContain('Split transactions cannot be transfers');
  });

  it('returns name not found error for missing account', async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.accounts.getAccounts.mockResolvedValue({
      data: { accounts: [] }
    });

    const result = await tool.execute('call-1', {
      budgetId: 'budget-123',
      account: 'Missing',
      payee: 'Store',
      amount: -50,
      date: '2026-04-29'
    });
    expect(result.content[0].text).toContain('Account "Missing" not found');
  });
});
