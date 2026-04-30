import { describe, it, expect } from "vitest";
import createYnabExtension from "../../../../../../src/plugins/agent/extensions/ynab/index.js";
import {
  createMockYnabAPI,
  createMockFastify,
  createMockExtensionAPI,
  getTools,
  makeHybridTransaction,
} from "../test-helpers.js";

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

    expect(result.content[0].text).toContain('Payee history for "Grocery Store"');
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
