import { describe, it, expect } from "vitest";
import {
  formatCreateTransactionResponse,
  formatCreateTransferResponse,
  formatCreateSplitResponse,
  formatSplitTransactionResponse,
} from "../../../../src/plugins/agent/extensions/ynab.js";

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
