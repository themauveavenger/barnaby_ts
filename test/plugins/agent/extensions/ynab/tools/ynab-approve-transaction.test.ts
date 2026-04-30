import { describe, it, expect } from "vitest";
import createYnabExtension from "../../../../../../src/plugins/agent/extensions/ynab/index.js";
import {
  createMockYnabAPI,
  createMockFastify,
  createMockExtensionAPI,
  getTools,
  makeTransactionDetail,
} from "../test-helpers.js";
import type * as ynab from "ynab";

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
