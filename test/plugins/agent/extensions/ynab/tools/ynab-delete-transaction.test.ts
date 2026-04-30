import { describe, it, expect } from "vitest";
import createYnabExtension from "../../../../../../src/plugins/agent/extensions/ynab/index.js";
import {
  createMockYnabAPI,
  createMockFastify,
  createMockExtensionAPI,
  getTools,
  makeTransactionDetail,
} from "../test-helpers.js";

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
