import { describe, it, expect } from "vitest";
import {
  formatCreateTransactionResponse,
  formatCreateTransferResponse,
  formatCreateSplitResponse,
  formatSplitTransactionResponse,
  formatApproveTransactionResponse,
  formatAlreadyApprovedResponse,
  formatDeleteTransactionResponse,
  formatFlagTransactionResponse,
  formatAlreadyFlaggedResponse,
} from "../../../../../src/plugins/agent/extensions/ynab/formatters.js";

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
