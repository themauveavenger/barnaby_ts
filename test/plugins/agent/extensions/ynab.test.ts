import { describe, it, expect, vi } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { FastifyInstance } from "fastify";
import type * as ynab from "ynab";
import createYnabExtension, {
  formatCreateTransactionResponse,
  formatCreateTransferResponse,
  formatCreateSplitResponse,
  formatSplitTransactionResponse,
  formatApproveTransactionResponse,
  formatAlreadyApprovedResponse,
  formatDeleteTransactionResponse,
  formatFlagTransactionResponse,
  formatAlreadyFlaggedResponse,
} from "../../../../src/plugins/agent/extensions/ynab.js";
import {
  formatMilliunits,
  formatAmount,
  validateAndResolveSplits,
  buildPayeeStats,
} from "../../../../src/plugins/agent/extensions/ynab-utils.js";
import currency from "currency.js";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockExtensionAPI(): ExtensionAPI & { _tools: Array<{ name: string; execute: Function }> } {
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

function getTools(extApi: ExtensionAPI) {
  return (extApi as unknown as { _tools: Array<{ name: string; execute: Function }> })._tools;
}

function createMockYnabAPI() {
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

function createMockFastify(ynabAPI: ReturnType<typeof createMockYnabAPI>) {
  return {
    ynabClient: { api: ynabAPI },
    log: { info: vi.fn(), error: vi.fn() },
  } as unknown as FastifyInstance;
}

function makeTransactionDetail(overrides: Partial<ynab.TransactionDetail> = {}): ynab.TransactionDetail {
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

function makeHybridTransaction(overrides: Partial<ynab.HybridTransaction> = {}): ynab.HybridTransaction {
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

// ---------------------------------------------------------------------------
// Existing formatting helper tests
// ---------------------------------------------------------------------------

describe("formatCreateTransactionResponse", () => {
  it("formats a regular transaction with all fields", () => {
    const result = formatCreateTransactionResponse(
      "Checking",
      "2026-04-29",
      "-$50.00",
      "Grocery Store",
      "Food",
      "Weekly shopping"
    );
    expect(result).toBe(
      "Created transaction in Checking.\n- Date: 2026-04-29 | Amount: -$50.00 | Payee: Grocery Store | Category: Food | Memo: Weekly shopping"
    );
  });

  it("formats a transaction without memo", () => {
    const result = formatCreateTransactionResponse(
      "Checking",
      "2026-04-29",
      "-$50.00",
      "Grocery Store",
      "Food",
      null
    );
    expect(result).toBe(
      "Created transaction in Checking.\n- Date: 2026-04-29 | Amount: -$50.00 | Payee: Grocery Store | Category: Food"
    );
  });

  it("formats a transaction without category", () => {
    const result = formatCreateTransactionResponse(
      "Checking",
      "2026-04-29",
      "-$50.00",
      "Grocery Store",
      null,
      null
    );
    expect(result).toBe(
      "Created transaction in Checking.\n- Date: 2026-04-29 | Amount: -$50.00 | Payee: Grocery Store | Category: (none)"
    );
  });
});

describe("formatCreateTransferResponse", () => {
  it("formats a transfer transaction", () => {
    const result = formatCreateTransferResponse(
      "Checking",
      "Savings",
      "2026-04-29",
      "-$100.00"
    );
    expect(result).toBe(
      "Created transfer from Checking to Savings.\n- Date: 2026-04-29 | Amount: -$100.00 | Transfer to Savings"
    );
  });
});

describe("formatCreateSplitResponse", () => {
  it("formats a split transaction", () => {
    const result = formatCreateSplitResponse(
      "Checking",
      "2026-04-29",
      "-$100.00",
      "Department Store",
      [
        { category: "Clothing", amount: "-$60.00" },
        { category: "Household", amount: "-$40.00" },
      ]
    );
    expect(result).toBe(
      "Created split transaction in Checking across 2 categories.\n- Date: 2026-04-29 | Amount: -$100.00 | Payee: Department Store\n  - Clothing: -$60.00\n  - Household: -$40.00"
    );
  });
});

describe("formatSplitTransactionResponse", () => {
  it("formats a split transaction update", () => {
    const result = formatSplitTransactionResponse("txn-123", [
      { category: "Food", amount: "-$30.00" },
      { category: "Transport", amount: "-$20.00" },
    ]);
    expect(result).toBe(
      "Split transaction txn-123 into 2 categories.\n- Food: -$30.00\n- Transport: -$20.00"
    );
  });
});

describe("formatApproveTransactionResponse", () => {
  it("formats an approved transaction", () => {
    const result = formatApproveTransactionResponse(
      "txn-456",
      "2026-04-29",
      "-$50.00",
      "Grocery Store",
      "Food",
      "cleared"
    );
    expect(result).toBe(
      "Approved transaction txn-456.\n- Date: 2026-04-29 | Amount: -$50.00 | Payee: Grocery Store | Category: Food | Cleared: yes"
    );
  });

  it("formats with uncleared status", () => {
    const result = formatApproveTransactionResponse(
      "txn-456",
      "2026-04-29",
      "-$50.00",
      "Grocery Store",
      null,
      "uncleared"
    );
    expect(result).toBe(
      "Approved transaction txn-456.\n- Date: 2026-04-29 | Amount: -$50.00 | Payee: Grocery Store | Category: (none) | Cleared: no"
    );
  });
});

describe("formatAlreadyApprovedResponse", () => {
  it("formats a no-op approval", () => {
    const result = formatAlreadyApprovedResponse(
      "txn-789",
      "2026-04-28",
      "-$25.00",
      "Coffee Shop",
      "Food",
      "cleared"
    );
    expect(result).toBe(
      "Transaction txn-789 was already approved. No changes needed.\n- Date: 2026-04-28 | Amount: -$25.00 | Payee: Coffee Shop | Category: Food | Cleared: yes"
    );
  });
});

describe("formatDeleteTransactionResponse", () => {
  it("formats a deleted transaction with memo", () => {
    const result = formatDeleteTransactionResponse(
      "txn-abc",
      "2026-04-27",
      "-$100.00",
      "Department Store",
      "Household",
      "Monthly supplies"
    );
    expect(result).toBe(
      "Deleted transaction txn-abc.\n- Date: 2026-04-27 | Amount: -$100.00 | Payee: Department Store | Category: Household | Memo: Monthly supplies"
    );
  });

  it("formats a deleted transaction without memo", () => {
    const result = formatDeleteTransactionResponse(
      "txn-abc",
      "2026-04-27",
      "-$100.00",
      "Department Store",
      "Household",
      null
    );
    expect(result).toBe(
      "Deleted transaction txn-abc.\n- Date: 2026-04-27 | Amount: -$100.00 | Payee: Department Store | Category: Household"
    );
  });
});

describe("formatFlagTransactionResponse", () => {
  it("formats a flagged transaction", () => {
    const result = formatFlagTransactionResponse("txn-def", "red", "Review this");
    expect(result).toBe(
      "Flagged transaction txn-def with red flag.\n- Memo: Review this"
    );
  });

  it("formats a cleared flag", () => {
    const result = formatFlagTransactionResponse("txn-def", null, null);
    expect(result).toBe("Cleared flag from transaction txn-def.");
  });
});

describe("formatAlreadyFlaggedResponse", () => {
  it("formats no-op when flag already set", () => {
    const result = formatAlreadyFlaggedResponse("txn-ghi", "blue");
    expect(result).toBe(
      "Transaction txn-ghi already has the blue flag. No changes needed."
    );
  });

  it("formats no-op when flag already cleared", () => {
    const result = formatAlreadyFlaggedResponse("txn-ghi", null);
    expect(result).toBe(
      "Transaction txn-ghi already has no flag. No changes needed."
    );
  });
});

// ---------------------------------------------------------------------------
// E2E tests for ynab_get_transactions
// ---------------------------------------------------------------------------

describe("ynab_get_transactions", () => {
  function setup() {
    const ynabAPI = createMockYnabAPI();
    const fastify = createMockFastify(ynabAPI);
    const extApi = createMockExtensionAPI();
    createYnabExtension(fastify)(extApi);
    const tools = getTools(extApi);
    const tool = tools.find((t) => t.name === "ynab_get_transactions")!;
    return { ynabAPI, fastify, extApi, tool };
  }

  it("uses default since date (30 days ago) and returns formatted transactions", async () => {
    const { ynabAPI, tool } = setup();
    const today = new Date();
    today.setDate(today.getDate() - 30);
    const expectedDate = today.toISOString().split("T")[0];

    ynabAPI.transactions.getTransactions.mockResolvedValue({
      data: {
        transactions: [
          makeTransactionDetail({ id: "txn-1", amount: -50000, payee_name: "Store", category_name: "Food" }),
        ],
      },
    });

    const result = await tool.execute("call-1", { budgetId: "budget-123" });
    expect(ynabAPI.transactions.getTransactions).toHaveBeenCalledWith("budget-123", expectedDate);
    expect(result.content[0].text).toContain("Returned 1 transactions from YNAB budget budget-123");
    expect(result.content[0].text).toContain("Store");
  });

  it("filters unapproved transactions", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactions.mockResolvedValue({
      data: {
        transactions: [
          makeTransactionDetail({ id: "txn-1", approved: true, payee_name: "Approved Store" }),
          makeTransactionDetail({ id: "txn-2", approved: false, payee_name: "Unapproved Store" }),
        ],
      },
    });

    const result = await tool.execute("call-1", { budgetId: "budget-123", sinceDate: "2026-04-01", unapproved: true });
    expect(result.content[0].text).toContain("Unapproved filter: true");
    expect(result.content[0].text).toContain("Unapproved Store");
    expect(result.content[0].text).not.toContain("Approved Store");
  });

  it("filters uncleared transactions", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactions.mockResolvedValue({
      data: {
        transactions: [
          makeTransactionDetail({ id: "txn-1", cleared: "cleared", payee_name: "Cleared Store" }),
          makeTransactionDetail({ id: "txn-2", cleared: "uncleared", payee_name: "Uncleared Store" }),
        ],
      },
    });

    const result = await tool.execute("call-1", { budgetId: "budget-123", sinceDate: "2026-04-01", uncleared: true });
    expect(result.content[0].text).toContain("Uncleared filter: true");
    expect(result.content[0].text).toContain("Uncleared Store");
    expect(result.content[0].text).not.toContain("Cleared Store");
  });

  it("formats output lines correctly", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactions.mockResolvedValue({
      data: {
        transactions: [
          makeTransactionDetail({
            id: "txn-1",
            date: "2026-04-15",
            amount: -25000,
            payee_name: "Coffee Shop",
            category_name: "Beverages",
            account_name: "Checking",
            cleared: "cleared",
            approved: true,
          }),
        ],
      },
    });

    const result = await tool.execute("call-1", { budgetId: "budget-123", sinceDate: "2026-04-01" });
    expect(result.content[0].text).toContain("- 2026-04-15 | -$25.00 | Coffee Shop | Beverages | Checking | cleared | approved");
  });

  it("formats 404 error when budget not found", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactions.mockRejectedValue({
      error: { id: "404", name: "not_found", detail: "Budget not found" },
    });

    const result = await tool.execute("call-1", { budgetId: "budget-123", sinceDate: "2026-04-01" });
    expect(result.content[0].text).toContain('Budget "budget-123" not found');
  });
});

// ---------------------------------------------------------------------------
// E2E tests for ynab_create_transaction
// ---------------------------------------------------------------------------

describe("ynab_create_transaction", () => {
  function setup() {
    const ynabAPI = createMockYnabAPI();
    const fastify = createMockFastify(ynabAPI);
    const extApi = createMockExtensionAPI();
    createYnabExtension(fastify)(extApi);
    const tools = getTools(extApi);
    const tool = tools.find((t) => t.name === "ynab_create_transaction")!;
    return { ynabAPI, fastify, extApi, tool };
  }

  it("creates a regular transaction", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.accounts.getAccounts.mockResolvedValue({
      data: { accounts: [{ id: "acc-1", name: "Checking", deleted: false, closed: false }] },
    });
    ynabAPI.payees.getPayees.mockResolvedValue({
      data: { payees: [{ id: "pay-1", name: "Grocery Store", deleted: false }] },
    });
    ynabAPI.categories.getCategories.mockResolvedValue({
      data: {
        category_groups: [
          {
            id: "cg-1",
            name: "Group",
            categories: [{ id: "cat-1", name: "Food", deleted: false, hidden: false }],
          },
        ],
      },
    });
    ynabAPI.transactions.createTransaction.mockResolvedValue({ data: {} });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      account: "Checking",
      payee: "Grocery Store",
      amount: -50,
      date: "2026-04-29",
      category: "Food",
      memo: "Weekly shopping",
    });

    expect(result.content[0].text).toContain("Created transaction in Checking.");
    expect(result.content[0].text).toContain("Grocery Store");
    expect(result.content[0].text).toContain("Food");
    expect(ynabAPI.transactions.createTransaction).toHaveBeenCalledWith("budget-123", {
      transaction: {
        account_id: "acc-1",
        payee_id: "pay-1",
        amount: -50000,
        category_id: "cat-1",
        date: "2026-04-29",
        memo: "Weekly shopping",
      },
    });
  });

  it("creates a transfer", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.accounts.getAccounts.mockResolvedValue({
      data: {
        accounts: [
          { id: "acc-1", name: "Checking", deleted: false, closed: false },
          { id: "acc-2", name: "Savings", deleted: false, closed: false },
        ],
      },
    });
    ynabAPI.accounts.getAccountById.mockResolvedValue({
      data: { account: { id: "acc-2", name: "Savings", transfer_payee_id: "tpay-1" } },
    });
    ynabAPI.transactions.createTransaction.mockResolvedValue({ data: {} });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      account: "Checking",
      transferToAccount: "Savings",
      amount: -100,
      date: "2026-04-29",
    });

    expect(result.content[0].text).toContain("Created transfer from Checking to Savings.");
    expect(ynabAPI.transactions.createTransaction).toHaveBeenCalledWith("budget-123", {
      transaction: {
        account_id: "acc-1",
        payee_id: "tpay-1",
        amount: -100000,
        date: "2026-04-29",
      },
    });
  });

  it("creates a split with null remainder", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.accounts.getAccounts.mockResolvedValue({
      data: { accounts: [{ id: "acc-1", name: "Checking", deleted: false, closed: false }] },
    });
    ynabAPI.payees.getPayees.mockResolvedValue({
      data: { payees: [{ id: "pay-1", name: "Store", deleted: false }] },
    });
    ynabAPI.categories.getCategories.mockResolvedValue({
      data: {
        category_groups: [
          {
            id: "cg-1",
            name: "Group",
            categories: [
              { id: "cat-1", name: "Clothing", deleted: false, hidden: false },
              { id: "cat-2", name: "Household", deleted: false, hidden: false },
            ],
          },
        ],
      },
    });
    ynabAPI.transactions.createTransaction.mockResolvedValue({ data: {} });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      account: "Checking",
      payee: "Store",
      amount: -100,
      date: "2026-04-29",
      splits: [
        { category: "Clothing", amount: -60 },
        { category: "Household", amount: null },
      ],
    });

    expect(result.content[0].text).toContain("Created split transaction in Checking across 2 categories.");
    expect(result.content[0].text).toContain("Clothing");
    expect(result.content[0].text).toContain("Household");
    expect(ynabAPI.transactions.createTransaction).toHaveBeenCalledWith("budget-123", {
      transaction: {
        account_id: "acc-1",
        payee_id: "pay-1",
        amount: -100000,
        date: "2026-04-29",
        subtransactions: [
          { amount: -60000, category_id: "cat-1", memo: null },
          { amount: -40000, category_id: "cat-2", memo: null },
        ],
      },
    });
  });

  it("returns validation error when payee and transfer both missing", async () => {
    const { tool } = setup();
    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      account: "Checking",
      amount: -50,
      date: "2026-04-29",
    });
    expect(result.content[0].text).toContain("Either 'payee' or 'transferToAccount' must be provided.");
  });

  it("returns validation error when transfer and splits both provided", async () => {
    const { tool } = setup();
    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      account: "Checking",
      transferToAccount: "Savings",
      amount: -50,
      date: "2026-04-29",
      splits: [{ category: "Food", amount: -50 }],
    });
    expect(result.content[0].text).toContain("Split transactions cannot be transfers");
  });

  it("returns name not found error for missing account", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.accounts.getAccounts.mockResolvedValue({
      data: { accounts: [] },
    });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      account: "Missing",
      payee: "Store",
      amount: -50,
      date: "2026-04-29",
    });
    expect(result.content[0].text).toContain('Account "Missing" not found');
  });
});

// ---------------------------------------------------------------------------
// E2E tests for ynab_split_transaction
// ---------------------------------------------------------------------------

describe("ynab_split_transaction", () => {
  function setup() {
    const ynabAPI = createMockYnabAPI();
    const fastify = createMockFastify(ynabAPI);
    const extApi = createMockExtensionAPI();
    createYnabExtension(fastify)(extApi);
    const tools = getTools(extApi);
    const tool = tools.find((t) => t.name === "ynab_split_transaction")!;
    return { ynabAPI, fastify, extApi, tool };
  }

  it("successfully splits a transaction", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById.mockResolvedValue({
      data: {
        transaction: makeTransactionDetail({ id: "txn-1", amount: -100000, subtransactions: [] }),
      },
    });
    ynabAPI.categories.getCategories.mockResolvedValue({
      data: {
        category_groups: [
          {
            id: "cg-1",
            name: "Group",
            categories: [
              { id: "cat-1", name: "Food", deleted: false, hidden: false },
              { id: "cat-2", name: "Transport", deleted: false, hidden: false },
            ],
          },
        ],
      },
    });
    ynabAPI.transactions.updateTransactions.mockResolvedValue({ data: {} });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      transactionId: "txn-1",
      splits: [
        { category: "Food", amount: -60 },
        { category: "Transport", amount: -40 },
      ],
    });

    expect(result.content[0].text).toContain("Split transaction txn-1 into 2 categories.");
    expect(ynabAPI.transactions.updateTransactions).toHaveBeenCalledWith(
      "budget-123",
      expect.objectContaining({
        transactions: expect.arrayContaining([
          expect.objectContaining({
            id: "txn-1",
            category_id: undefined,
            subtransactions: expect.arrayContaining([
              expect.objectContaining({ amount: -60000, category_id: "cat-1" }),
              expect.objectContaining({ amount: -40000, category_id: "cat-2" }),
            ]),
          }),
        ]),
      })
    );
  });

  it("guards against already-split transactions", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById.mockResolvedValue({
      data: {
        transaction: makeTransactionDetail({
          id: "txn-1",
          subtransactions: [
            { id: "sub-1", transaction_id: "txn-1", amount: -50000, deleted: false },
          ] as ynab.SubTransaction[],
        }),
      },
    });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      transactionId: "txn-1",
      splits: [
        { category: "Food", amount: -60 },
        { category: "Transport", amount: -40 },
      ],
    });

    expect(result.content[0].text).toContain("already split");
    expect(ynabAPI.transactions.updateTransactions).not.toHaveBeenCalled();
  });

  it("returns split validation error for invalid amounts", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById.mockResolvedValue({
      data: {
        transaction: makeTransactionDetail({ id: "txn-1", amount: -100000, subtransactions: [] }),
      },
    });
    ynabAPI.categories.getCategories.mockResolvedValue({
      data: {
        category_groups: [
          {
            id: "cg-1",
            name: "Group",
            categories: [
              { id: "cat-1", name: "Food", deleted: false, hidden: false },
              { id: "cat-2", name: "Transport", deleted: false, hidden: false },
            ],
          },
        ],
      },
    });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      transactionId: "txn-1",
      splits: [
        { category: "Food", amount: -30 },
        { category: "Transport", amount: -40 },
      ],
    });

    expect(result.content[0].text).toContain("Invalid split amounts");
  });
});

// ---------------------------------------------------------------------------
// E2E tests for ynab_approve_transaction
// ---------------------------------------------------------------------------

describe("ynab_approve_transaction", () => {
  function setup() {
    const ynabAPI = createMockYnabAPI();
    const fastify = createMockFastify(ynabAPI);
    const extApi = createMockExtensionAPI();
    createYnabExtension(fastify)(extApi);
    const tools = getTools(extApi);
    const tool = tools.find((t) => t.name === "ynab_approve_transaction")!;
    return { ynabAPI, fastify, extApi, tool };
  }

  it("approves with category and cleared", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById
      .mockResolvedValueOnce({
        data: {
          transaction: makeTransactionDetail({
            id: "txn-1",
            approved: false,
            cleared: "uncleared",
            category_name: null,
            subtransactions: [],
          }),
        },
      })
      .mockResolvedValue({
        data: {
          transaction: makeTransactionDetail({
            id: "txn-1",
            approved: true,
            cleared: "cleared",
            category_name: "Food",
            subtransactions: [],
          }),
        },
      });
    ynabAPI.categories.getCategories.mockResolvedValue({
      data: {
        category_groups: [
          {
            id: "cg-1",
            name: "Group",
            categories: [{ id: "cat-1", name: "Food", deleted: false, hidden: false }],
          },
        ],
      },
    });
    ynabAPI.transactions.updateTransactions.mockResolvedValue({ data: {} });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      transactionId: "txn-1",
      category: "Food",
      cleared: true,
    });

    expect(result.content[0].text).toContain("Approved transaction txn-1.");
    expect(result.content[0].text).toContain("Food");
    expect(result.content[0].text).toContain("Cleared: yes");
    expect(ynabAPI.transactions.updateTransactions).toHaveBeenCalledWith("budget-123", {
      transactions: [
        {
          id: "txn-1",
          approved: true,
          category_id: "cat-1",
          cleared: "cleared",
        },
      ],
    });
  });

  it("is idempotent when already approved with no meaningful changes", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById.mockResolvedValue({
      data: {
        transaction: makeTransactionDetail({
          id: "txn-1",
          approved: true,
          cleared: "cleared",
          category_name: "Food",
          subtransactions: [],
        }),
      },
    });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      transactionId: "txn-1",
    });

    expect(result.content[0].text).toContain("already approved");
    expect(ynabAPI.transactions.updateTransactions).not.toHaveBeenCalled();
  });

  it("returns error when trying to category a split transaction", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById.mockResolvedValue({
      data: {
        transaction: makeTransactionDetail({
          id: "txn-1",
          approved: false,
          subtransactions: [
            { id: "sub-1", transaction_id: "txn-1", amount: -50000, deleted: false },
          ] as ynab.SubTransaction[],
        }),
      },
    });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      transactionId: "txn-1",
      category: "Food",
    });

    expect(result.content[0].text).toContain("Cannot assign category");
    expect(result.content[0].text).toContain("split transaction");
  });
});

// ---------------------------------------------------------------------------
// E2E tests for ynab_delete_transaction
// ---------------------------------------------------------------------------

describe("ynab_delete_transaction", () => {
  function setup() {
    const ynabAPI = createMockYnabAPI();
    const fastify = createMockFastify(ynabAPI);
    const extApi = createMockExtensionAPI();
    createYnabExtension(fastify)(extApi);
    const tools = getTools(extApi);
    const tool = tools.find((t) => t.name === "ynab_delete_transaction")!;
    return { ynabAPI, fastify, extApi, tool };
  }

  it("successfully deletes a transaction", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById.mockResolvedValue({
      data: {
        transaction: makeTransactionDetail({
          id: "txn-1",
          date: "2026-04-27",
          amount: -100000,
          payee_name: "Department Store",
          category_name: "Household",
          memo: "Monthly supplies",
        }),
      },
    });
    ynabAPI.transactions.deleteTransaction.mockResolvedValue({ data: {} });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      transactionId: "txn-1",
    });

    expect(result.content[0].text).toContain("Deleted transaction txn-1.");
    expect(result.content[0].text).toContain("Department Store");
    expect(ynabAPI.transactions.deleteTransaction).toHaveBeenCalledWith("budget-123", "txn-1");
  });

  it("handles already-deleted (404) gracefully", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById.mockRejectedValue({
      error: { id: "404", name: "not_found", detail: "Transaction not found" },
    });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      transactionId: "txn-1",
    });

    expect(result.content[0].text).toContain("already deleted or did not exist");
  });
});

// ---------------------------------------------------------------------------
// E2E tests for ynab_flag_transaction
// ---------------------------------------------------------------------------

describe("ynab_flag_transaction", () => {
  function setup() {
    const ynabAPI = createMockYnabAPI();
    const fastify = createMockFastify(ynabAPI);
    const extApi = createMockExtensionAPI();
    createYnabExtension(fastify)(extApi);
    const tools = getTools(extApi);
    const tool = tools.find((t) => t.name === "ynab_flag_transaction")!;
    return { ynabAPI, fastify, extApi, tool };
  }

  it("flags with color and reason", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById
      .mockResolvedValueOnce({
        data: {
          transaction: makeTransactionDetail({
            id: "txn-1",
            flag_color: null,
            memo: "",
          }),
        },
      })
      .mockResolvedValue({
        data: {
          transaction: makeTransactionDetail({
            id: "txn-1",
            flag_color: "red",
            memo: "Amount outside expected range",
          }),
        },
      });
    ynabAPI.transactions.updateTransactions.mockResolvedValue({ data: {} });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      transactionId: "txn-1",
      flagColor: "red",
      reason: "amount_anomaly",
    });

    expect(result.content[0].text).toContain("Flagged transaction txn-1 with red flag.");
    expect(ynabAPI.transactions.updateTransactions).toHaveBeenCalledWith("budget-123", {
      transactions: [
        {
          id: "txn-1",
          flag_color: "red",
          memo: "Amount outside expected range",
        },
      ],
    });
  });

  it("clears flag", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById
      .mockResolvedValueOnce({
        data: {
          transaction: makeTransactionDetail({
            id: "txn-1",
            flag_color: "red",
            memo: "Some memo",
          }),
        },
      })
      .mockResolvedValue({
        data: {
          transaction: makeTransactionDetail({
            id: "txn-1",
            flag_color: null,
            memo: "Some memo",
          }),
        },
      });
    ynabAPI.transactions.updateTransactions.mockResolvedValue({ data: {} });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      transactionId: "txn-1",
      clearFlag: true,
    });

    expect(result.content[0].text).toContain("Cleared flag from transaction txn-1.");
    expect(ynabAPI.transactions.updateTransactions).toHaveBeenCalledWith("budget-123", {
      transactions: [
        {
          id: "txn-1",
          flag_color: "",
        },
      ],
    });
  });

  it("is idempotent when already flagged with same color", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.transactions.getTransactionById.mockResolvedValue({
      data: {
        transaction: makeTransactionDetail({
          id: "txn-1",
          flag_color: "blue",
          memo: "",
        }),
      },
    });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      transactionId: "txn-1",
      flagColor: "blue",
    });

    expect(result.content[0].text).toContain("already has the blue flag");
    expect(ynabAPI.transactions.updateTransactions).not.toHaveBeenCalled();
  });

  it("returns validation error when neither flagColor nor clearFlag provided", async () => {
    const { tool } = setup();
    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      transactionId: "txn-1",
    });

    expect(result.content[0].text).toContain("Must provide either flagColor or clearFlag=true.");
  });

  it("returns validation error when both flagColor and clearFlag provided", async () => {
    const { tool } = setup();
    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      transactionId: "txn-1",
      flagColor: "red",
      clearFlag: true,
    });

    expect(result.content[0].text).toContain("but not both.");
  });
});

// ---------------------------------------------------------------------------
// E2E tests for ynab_get_payee_history
// ---------------------------------------------------------------------------

describe("ynab_get_payee_history", () => {
  function setup() {
    const ynabAPI = createMockYnabAPI();
    const fastify = createMockFastify(ynabAPI);
    const extApi = createMockExtensionAPI();
    createYnabExtension(fastify)(extApi);
    const tools = getTools(extApi);
    const tool = tools.find((t) => t.name === "ynab_get_payee_history")!;
    return { ynabAPI, fastify, extApi, tool };
  }

  it("calculates statistics correctly", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.payees.getPayees.mockResolvedValue({
      data: { payees: [{ id: "pay-1", name: "Grocery Store", deleted: false }] },
    });
    ynabAPI.transactions.getTransactionsByPayee.mockResolvedValue({
      data: {
        transactions: [
          makeHybridTransaction({ id: "txn-1", date: "2026-04-20", amount: -50000, category_name: "Food" }),
          makeHybridTransaction({ id: "txn-2", date: "2026-04-10", amount: -75000, category_name: "Food" }),
          makeHybridTransaction({ id: "txn-3", date: "2026-03-25", amount: -30000, category_name: "Snacks" }),
        ],
      },
    });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      payeeName: "Grocery Store",
      sinceDate: "2026-03-01",
    });

    expect(result.content[0].text).toContain("Payee history for \"Grocery Store\"");
    expect(result.content[0].text).toContain("Transactions: 3");
    expect(result.content[0].text).toContain("Most common category: Food");
  });

  it("excludes transfers when includeTransfers is false", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.payees.getPayees.mockResolvedValue({
      data: { payees: [{ id: "pay-1", name: "Transfer : Savings", deleted: false }] },
    });
    ynabAPI.transactions.getTransactionsByPayee.mockResolvedValue({
      data: {
        transactions: [
          makeHybridTransaction({ id: "txn-1", date: "2026-04-20", amount: -50000, transfer_account_id: "acc-2" }),
          makeHybridTransaction({ id: "txn-2", date: "2026-04-10", amount: -75000 }),
        ],
      },
    });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      payeeName: "Transfer : Savings",
      sinceDate: "2026-03-01",
    });

    expect(result.content[0].text).toContain("Transactions: 1");
  });

  it("returns payee not found error", async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.payees.getPayees.mockResolvedValue({
      data: { payees: [] },
    });

    const result = await tool.execute("call-1", {
      budgetId: "budget-123",
      payeeName: "Unknown Store",
      sinceDate: "2026-03-01",
    });

    expect(result.content[0].text).toContain('Payee "Unknown Store" not found');
  });
});

// ---------------------------------------------------------------------------
// Utility helper tests
// ---------------------------------------------------------------------------

describe("formatMilliunits", () => {
  it("formats positive milliunits", () => {
    expect(formatMilliunits(50000)).toBe("$50.00");
  });

  it("formats negative milliunits", () => {
    expect(formatMilliunits(-50000)).toBe("-$50.00");
  });

  it("formats zero", () => {
    expect(formatMilliunits(0)).toBe("$0.00");
  });
});

describe("formatAmount", () => {
  it("formats a currency object", () => {
    expect(formatAmount(currency(1234.56))).toBe("$1,234.56");
  });

  it("formats a negative currency object", () => {
    expect(formatAmount(currency(-99.99))).toBe("-$99.99");
  });
});

describe("validateAndResolveSplits", () => {
  async function setupCategories() {
    const ynabAPI = createMockYnabAPI();
    ynabAPI.categories.getCategories.mockResolvedValue({
      data: {
        category_groups: [
          {
            id: "cg-1",
            name: "Group",
            categories: [
              { id: "cat-1", name: "Food", deleted: false, hidden: false },
              { id: "cat-2", name: "Transport", deleted: false, hidden: false },
            ],
          },
        ],
      },
    });
    return ynabAPI;
  }

  it("resolves valid splits with explicit amounts", async () => {
    const ynabAPI = await setupCategories();
    const result = await validateAndResolveSplits(ynabAPI as unknown as ynab.API, "budget-123", currency(-100), [
      { category: "Food", amount: currency(-60) },
      { category: "Transport", amount: currency(-40) },
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.subtransactions).toHaveLength(2);
    expect(result.subtransactions[0].amount).toBe(-60000);
    expect(result.subtransactions[1].amount).toBe(-40000);
  });

  it("resolves valid splits with null remainder", async () => {
    const ynabAPI = await setupCategories();
    const result = await validateAndResolveSplits(ynabAPI as unknown as ynab.API, "budget-123", currency(-100), [
      { category: "Food", amount: currency(-60) },
      { category: "Transport", amount: null },
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.subtransactions).toHaveLength(2);
    expect(result.subtransactions[0].amount).toBe(-60000);
    expect(result.subtransactions[1].amount).toBe(-40000);
  });

  it("errors when fewer than 2 splits", async () => {
    const ynabAPI = await setupCategories();
    const result = await validateAndResolveSplits(ynabAPI as unknown as ynab.API, "budget-123", currency(-100), [
      { category: "Food", amount: currency(-100) },
    ]);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("at least 2 splits");
  });

  it("errors when more than one null amount", async () => {
    const ynabAPI = await setupCategories();
    const result = await validateAndResolveSplits(ynabAPI as unknown as ynab.API, "budget-123", currency(-100), [
      { category: "Food", amount: null },
      { category: "Transport", amount: null },
    ]);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Only one split may have a null amount");
  });

  it("errors when explicit amounts do not sum to total", async () => {
    const ynabAPI = await setupCategories();
    const result = await validateAndResolveSplits(ynabAPI as unknown as ynab.API, "budget-123", currency(-100), [
      { category: "Food", amount: currency(-30) },
      { category: "Transport", amount: currency(-40) },
    ]);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Split amounts sum to");
  });

  it("errors when remainder is zero", async () => {
    const ynabAPI = await setupCategories();
    const result = await validateAndResolveSplits(ynabAPI as unknown as ynab.API, "budget-123", currency(-100), [
      { category: "Food", amount: currency(-100) },
      { category: "Transport", amount: null },
    ]);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("remainder is 0");
  });

  it("errors when category not found", async () => {
    const ynabAPI = createMockYnabAPI();
    ynabAPI.categories.getCategories.mockResolvedValue({
      data: {
        category_groups: [
          {
            id: "cg-1",
            name: "Group",
            categories: [{ id: "cat-1", name: "Food", deleted: false, hidden: false }],
          },
        ],
      },
    });
    const result = await validateAndResolveSplits(ynabAPI as unknown as ynab.API, "budget-123", currency(-100), [
      { category: "Missing", amount: currency(-50) },
      { category: "Food", amount: currency(-50) },
    ]);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Category "Missing" not found');
  });
});

describe("buildPayeeStats", () => {
  it("calculates mean, median, std dev, and frequency", () => {
    const transactions: ynab.HybridTransaction[] = [
      makeHybridTransaction({ id: "txn-1", date: "2026-04-20", amount: -50000, category_name: "Food" }),
      makeHybridTransaction({ id: "txn-2", date: "2026-04-10", amount: -75000, category_name: "Food" }),
      makeHybridTransaction({ id: "txn-3", date: "2026-03-25", amount: -30000, category_name: "Snacks" }),
    ];

    const stats = buildPayeeStats(transactions);

    expect(stats.transactionCount).toBe(3);
    expect(stats.totalSpent).toBe(155000);
    expect(stats.averageAmount).toBeCloseTo(51666.67, 1);
    expect(stats.medianAmount).toBe(50000);
    expect(stats.minAmount).toBe(30000);
    expect(stats.maxAmount).toBe(75000);
    expect(stats.stdDeviation).toBeCloseTo(18408.94, 1);
    expect(stats.frequencyDays).not.toBeNull();
    expect(stats.mostCommonCategory).toBe("Food");
    expect(stats.refundCount).toBe(0);
    expect(stats.recentTransactions).toHaveLength(3);
  });

  it("returns zeros for empty transactions", () => {
    const stats = buildPayeeStats([]);

    expect(stats.transactionCount).toBe(0);
    expect(stats.totalSpent).toBe(0);
    expect(stats.averageAmount).toBe(0);
    expect(stats.medianAmount).toBe(0);
    expect(stats.minAmount).toBe(0);
    expect(stats.maxAmount).toBe(0);
    expect(stats.stdDeviation).toBe(0);
    expect(stats.frequencyDays).toBeNull();
    expect(stats.mostCommonCategory).toBeNull();
    expect(stats.refundCount).toBe(0);
  });

  it("counts refunds as inflows", () => {
    const transactions: ynab.HybridTransaction[] = [
      makeHybridTransaction({ id: "txn-1", date: "2026-04-20", amount: -50000, category_name: "Food" }),
      makeHybridTransaction({ id: "txn-2", date: "2026-04-10", amount: 25000, category_name: "Refund" }),
    ];

    const stats = buildPayeeStats(transactions);

    expect(stats.transactionCount).toBe(1);
    expect(stats.refundCount).toBe(1);
    expect(stats.totalSpent).toBe(50000);
  });
});
