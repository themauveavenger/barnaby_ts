import type { FastifyInstance } from "fastify";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import ynabGetTransactionsTool from "./tools/ynab-get-transactions.js";
import ynabGetPayeeHistoryTool from "./tools/ynab-get-payee-history.js";
import ynabCreateTransactionTool from "./tools/ynab-create-transaction.js";
import ynabSplitTransactionTool from "./tools/ynab-split-transaction.js";
import ynabApproveTransactionTool from "./tools/ynab-approve-transaction.js";
import ynabDeleteTransactionTool from "./tools/ynab-delete-transaction.js";
import ynabFlagTransactionTool from "./tools/ynab-flag-transaction.js";

export default function createYnabExtension(fastify: FastifyInstance) {
  return (pi: ExtensionAPI) => {
    pi.registerTool(ynabGetTransactionsTool(fastify));
    pi.registerTool(ynabGetPayeeHistoryTool(fastify));
    pi.registerTool(ynabCreateTransactionTool(fastify));
    pi.registerTool(ynabSplitTransactionTool(fastify));
    pi.registerTool(ynabApproveTransactionTool(fastify));
    pi.registerTool(ynabDeleteTransactionTool(fastify));
    pi.registerTool(ynabFlagTransactionTool(fastify));
  };
}
