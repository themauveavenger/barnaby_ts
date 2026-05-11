import type { FastifyInstance } from "fastify";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import currency from "currency.js";
import type * as ynab from "ynab";
import {
  formatMilliunits,
  getYnabErrorMessage,
  isYnabNotFoundError,
  resolveAccountId,
  resolveCategoryId,
  resolvePayeeId,
  validateAndResolveSplits,
} from "../utils.js";
import {
  formatCreateTransactionResponse,
  formatCreateTransferResponse,
  formatCreateSplitResponse,
} from "../formatters.js";

const paramsSchema = Type.Object({
  budgetId: Type.String({ description: "The UUID of the YNAB budget" }),
  account: Type.String({ description: "Exact account name as it appears in YNAB" }),
  payee: Type.Optional(Type.String({ description: "Exact payee name. Required unless transferToAccount is provided." })),
  transferToAccount: Type.Optional(Type.String({ description: "Exact name of target account for a transfer. Mutually exclusive with payee and splits." })),
  amount: Type.Number({ description: "Amount in dollars. Negative for outflow, positive for inflow." }),
  date: Type.String({ description: "Transaction date (YYYY-MM-DD)" }),
  category: Type.Optional(Type.String({ description: "Category name. Ignored for splits and transfers." })),
  memo: Type.Optional(Type.String({ description: "Optional memo/note" })),
  splits: Type.Optional(Type.Array(
    Type.Object({
      category: Type.String({ description: "Category name for this split" }),
      amount: Type.Union([Type.Number(), Type.Null()], { description: "Amount in dollars, or null to calculate from remainder" }),
      memo: Type.Optional(Type.String({ description: "Optional memo for this split" })),
    }),
    { description: "Splits to divide the transaction. Mutually exclusive with transferToAccount. At least 2 splits, at most one null amount." }
  )),
});

export default function createTool(fastify: FastifyInstance): ToolDefinition<typeof paramsSchema> {
  return {
    name: "ynab_create_transaction",
    label: "Create YNAB Transaction",
    description:
      "Creates a new transaction in a YNAB budget. Supports regular transactions, transfers between accounts, and split transactions.",
    parameters: paramsSchema,
    async execute(_toolCallId, params) {
      try {
        if (!params.payee && !params.transferToAccount) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Cannot create transaction. Either 'payee' or 'transferToAccount' must be provided.",
              },
            ],
            details: {},
          };
        }

        if (params.transferToAccount && params.splits) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Cannot create transaction. Split transactions cannot be transfers. Provide either 'transferToAccount' or 'splits', not both.",
              },
            ],
            details: {},
          };
        }

        const ynabAPI = fastify.ynabClient.api;

        const accountId = await resolveAccountId(ynabAPI, params.budgetId, params.account);
        if (!accountId) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Account "${params.account}" not found. Verify the exact name as it appears in YNAB.`,
              },
            ],
            details: {},
          };
        }

        let payeeId: string | undefined = undefined;
        let isTransfer = false;
        let targetAccountName: string | undefined = undefined;

        if (params.transferToAccount) {
          isTransfer = true;
          targetAccountName = params.transferToAccount;
          const targetAccountId = await resolveAccountId(ynabAPI, params.budgetId, params.transferToAccount);
          if (!targetAccountId) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: Account "${params.transferToAccount}" not found. Verify the exact name as it appears in YNAB.`,
                },
              ],
              details: {},
            };
          }

          const accountResponse = await ynabAPI.accounts.getAccountById(params.budgetId, targetAccountId);
          const targetAccount = accountResponse.data.account;
          if (!targetAccount.transfer_payee_id) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: Account "${params.transferToAccount}" does not support transfers.`,
                },
              ],
              details: {},
            };
          }
          payeeId = targetAccount.transfer_payee_id;
        } else if (params.payee) {
          const resolvedPayeeId = await resolvePayeeId(ynabAPI, params.budgetId, params.payee);
          if (!resolvedPayeeId) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: Payee "${params.payee}" not found. Verify the exact name as it appears in YNAB.`,
                },
              ],
              details: {},
            };
          }
          payeeId = resolvedPayeeId;
        }

        const amountMilliunits = Math.round(currency(params.amount).value * 1000);
        const amountFormatted = formatMilliunits(amountMilliunits);

        if (params.splits) {
          const splitInputs = params.splits.map((s) => ({
            category: s.category,
            amount: s.amount === null ? null : currency(s.amount),
            memo: s.memo,
          }));
          const result = await validateAndResolveSplits(ynabAPI, params.budgetId, currency(params.amount), splitInputs);
          if (result.errors.length > 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: Invalid split amounts.\n${result.errors.join("\n")}`,
                },
              ],
              details: {},
            };
          }
          const subtransactions = result.subtransactions;

          await ynabAPI.transactions.createTransaction(params.budgetId, {
            transaction: {
              account_id: accountId,
              payee_id: payeeId,
              category_id: undefined,
              amount: amountMilliunits,
              date: params.date,
              memo: params.memo ?? undefined,
              subtransactions,
            },
          });

          const splitLines = params.splits.map((split, i) => ({
            category: split.category,
            amount: formatMilliunits(subtransactions[i].amount),
          }));
          const text = formatCreateSplitResponse(
            params.account,
            params.date,
            amountFormatted,
            params.payee ?? "(none)",
            splitLines
          );
          return {
            content: [{ type: "text" as const, text }],
            details: {},
          };
        }

        let categoryId: string | null = null;
        if (params.category) {
          const resolvedCategoryId = await resolveCategoryId(ynabAPI, params.budgetId, params.category);
          if (!resolvedCategoryId) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: Category "${params.category}" not found. Verify the exact name as it appears in YNAB.`,
                },
              ],
              details: {},
            };
          }
          categoryId = resolvedCategoryId;
        }

        await ynabAPI.transactions.createTransaction(params.budgetId, {
          transaction: {
            account_id: accountId,
            payee_id: payeeId,
            category_id: categoryId ?? undefined,
            amount: amountMilliunits,
            date: params.date,
            memo: params.memo ?? undefined,
          },
        });

        if (isTransfer && targetAccountName) {
          const text = formatCreateTransferResponse(
            params.account,
            targetAccountName,
            params.date,
            amountFormatted
          );
          return {
            content: [{ type: "text" as const, text }],
            details: {},
          };
        }

        const text = formatCreateTransactionResponse(
          params.account,
          params.date,
          amountFormatted,
          params.payee ?? "(none)",
          params.category ?? null,
          params.memo ?? null
        );
        return {
          content: [{ type: "text" as const, text }],
          details: {},
        };
      } catch (error) {
        const message = isYnabNotFoundError(error)
          ? `Budget "${params.budgetId}" not found. Verify the budget ID.`
          : getYnabErrorMessage(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Failed to create transaction in YNAB.\n${message}`,
            },
          ],
          details: {},
        };
      }
    },
  };
}
