import { describe, it, expect } from "vitest";
import {
  formatMilliunits,
  formatAmount,
  validateAndResolveSplits,
  buildPayeeStats,
} from "../../../../../src/plugins/agent/extensions/ynab/utils.js";
import currency from "currency.js";
import { createMockYnabAPI, makeHybridTransaction } from "./test-helpers.js";
import type * as ynab from "ynab";

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
