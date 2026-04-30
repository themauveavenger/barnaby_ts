import { describe, it, expect } from "vitest";
import createYnabExtension from "../../../../../../src/plugins/agent/extensions/ynab/index.js";
import {
  createMockYnabAPI,
  createMockFastify,
  createMockExtensionAPI,
  getTools,
  makeTransactionDetail,
} from "../test-helpers.js";

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
