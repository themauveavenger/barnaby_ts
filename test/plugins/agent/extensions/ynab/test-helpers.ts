import { vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { FastifyInstance } from "fastify";
import type * as ynab from "ynab";

export function createMockExtensionAPI(): ExtensionAPI & { _tools: Array<{ name: string; execute: Function }> } {
  const tools: Array<{ name: string; execute: Function }> = [];
  return {
    registerTool: vi.fn((tool) => tools.push(tool)),
    on: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    registerFlag: vi.fn(),
    _tools: tools,
  } as unknown as ExtensionAPI & { _tools: typeof tools };
}

export function getTools(extApi: ExtensionAPI) {
  return (extApi as unknown as { _tools: Array<{ name: string; execute: Function }> })._tools;
}

export function createMockYnabAPI() {
  return {
    transactions: {
      getTransactions: vi.fn(),
      getTransactionsByPayee: vi.fn(),
      getTransactionById: vi.fn(),
      createTransaction: vi.fn(),
      updateTransactions: vi.fn(),
      deleteTransaction: vi.fn(),
    },
    accounts: {
      getAccounts: vi.fn(),
      getAccountById: vi.fn(),
    },
    categories: {
      getCategories: vi.fn(),
    },
    payees: {
      getPayees: vi.fn(),
    },
  };
}

export function createMockFastify(ynabAPI: ReturnType<typeof createMockYnabAPI>) {
  return {
    ynabClient: { api: ynabAPI },
    log: { info: vi.fn(), error: vi.fn() },
  } as unknown as FastifyInstance;
}

export function makeTransactionDetail(overrides: Partial<ynab.TransactionDetail> = {}): ynab.TransactionDetail {
  return {
    id: "txn-1",
    date: "2026-04-29",
    amount: -50000,
    cleared: "cleared",
    approved: true,
    account_id: "acc-1",
    account_name: "Checking",
    payee_name: "Grocery Store",
    category_name: "Food",
    subtransactions: [],
    deleted: false,
    ...overrides,
  };
}

export function makeHybridTransaction(overrides: Partial<ynab.HybridTransaction> = {}): ynab.HybridTransaction {
  return {
    id: "txn-1",
    date: "2026-04-29",
    amount: -50000,
    cleared: "cleared",
    approved: true,
    account_id: "acc-1",
    account_name: "Checking",
    payee_name: "Grocery Store",
    category_name: "Food",
    deleted: false,
    type: "transaction",
    ...overrides,
  };
}
