# YNAB Extension Refactor Design Spec

## Date: 2026-04-30

## Overview

Refactor the YNAB extension from a single 1077-line monolith (`src/plugins/agent/extensions/ynab.ts`) into a focused directory of single-responsibility modules. Each LLM-callable tool gets its own file. Formatting helpers and pure utilities also get dedicated homes. Tests are split to match.

## Goals

- Reduce `ynab.ts` from 1077 lines to a ~20-line manifest (`ynab/index.ts`).
- Give each of the 7 tools its own file with one clear responsibility.
- Co-locate all YNAB extension code inside `src/plugins/agent/extensions/ynab/`.
- Preserve existing behavior, types, and test coverage.
- Follow barnaby's existing patterns: explicit return types, `import type` for type-only imports, `.js` extensions in imports.

## Non-Goals

- Change tool behavior, schemas, or output formatting.
- Change the `ynab-client.ts` Fastify plugin or `FastifyInstance` decoration.
- Introduce new abstractions (e.g., shared error-handling wrappers).

## Architecture

### File Structure (Source)

```
src/plugins/agent/extensions/ynab/
├── index.ts                    # Extension factory: imports & registers all 7 tools
├── formatters.ts               # All formatting helpers + SplitLine interface
├── utils.ts                    # Moved from ynab-utils.ts (resolvers, splits, stats, errors)
└── tools/
    ├── ynab-get-transactions.ts
    ├── ynab-get-payee-history.ts
    ├── ynab-create-transaction.ts
    ├── ynab-split-transaction.ts
    ├── ynab-approve-transaction.ts
    ├── ynab-delete-transaction.ts
    └── ynab-flag-transaction.ts
```

### Deleted Files

- `src/plugins/agent/extensions/ynab.ts` (superseded by `ynab/index.ts`)
- `src/plugins/agent/extensions/ynab-utils.ts` (moved to `ynab/utils.ts`)

### Unchanged Consumers

- `src/plugins/agent/index.ts` continues to import `createYnabExtension` from `./extensions/ynab.js`. Node.js ESM resolution routes `ynab.js` to `ynab/index.ts`.

## Tool Factory Pattern

Each tool file exports a single default factory with an explicit generic return type.

```ts
import type { FastifyInstance } from "fastify";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

const paramsSchema = Type.Object({
  budgetId: Type.String({ description: "The UUID of the YNAB budget" }),
  // ... etc
});

export default function createTool(
  fastify: FastifyInstance
): ToolDefinition<typeof paramsSchema> {
  return {
    name: "ynab_get_transactions",
    label: "Get YNAB Transactions",
    description:
      "Fetches transactions from a YNAB budget. Use unapproved=true to find bank imports awaiting review.",
    parameters: paramsSchema,
    async execute(_toolCallId, params) {
      const ynabAPI = fastify.ynabClient.api;
      // tool-specific logic
    },
  };
}
```

**Rules:**
- Extract `paramsSchema` to a top-level `const` so `typeof paramsSchema` can be used in the return type.
- The return type must be `ToolDefinition<typeof paramsSchema>` to preserve TypeBox inference inside `execute`.
- No `as` casts, no `any`, no `defineTool` wrapper.

## Formatter Organization

`formatters.ts` contains all pure formatting helpers moved from the old monolithic `ynab.ts`:

- `formatTransactionLine`
- `formatTransactionsResponse`
- `formatPayeeHistoryResponse`
- `formatCreateTransactionResponse`
- `formatCreateTransferResponse`
- `formatCreateSplitResponse`
- `formatSplitTransactionResponse`
- `formatApproveTransactionResponse`
- `formatAlreadyApprovedResponse`
- `formatDeleteTransactionResponse`
- `formatFlagTransactionResponse`
- `formatAlreadyFlaggedResponse`
- `SplitLine` interface

These functions have no Fastify dependencies. Tool files import them from `../formatters.js`.

## Utility Organization

`utils.ts` contains all pure helpers moved from `ynab-utils.ts`:

- Name resolvers: `resolveAccountId`, `resolveCategoryId`, `resolvePayeeId`
- Split validation: `validateAndResolveSplits`, `SplitInput`, `ValidateSplitsResult`
- Money formatting: `formatMilliunits`, `formatAmount`
- Date utilities: `getDefaultSinceDate`, `getDefaultPayeeSinceDate`, `daysBetween`, `calculateFrequencyDays`
- Payee statistics: `buildPayeeStats`, `PayeeStats`, `mostCommonCategory`
- Error helpers: `getYnabErrorMessage`, `isYnabNotFoundError`

## Test Structure

```
test/plugins/agent/extensions/ynab/
├── test-helpers.ts             # Shared mocks: createMockExtensionAPI, createMockYnabAPI, etc.
├── formatters.test.ts          # Unit tests for all formatting helpers
├── utils.test.ts               # validateAndResolveSplits, buildPayeeStats, etc.
└── tools/
    ├── ynab-get-transactions.test.ts
    ├── ynab-get-payee-history.test.ts
    ├── ynab-create-transaction.test.ts
    ├── ynab-split-transaction.test.ts
    ├── ynab-approve-transaction.test.ts
    ├── ynab-delete-transaction.test.ts
    └── ynab-flag-transaction.test.ts
```

### Deleted Files

- `test/plugins/agent/extensions/ynab.test.ts` (superseded by the above)

### Test Pattern

Each tool test follows the same setup pattern:

1. Create mock YNAB API (`createMockYnabAPI`).
2. Create mock Fastify (`createMockFastify`).
3. Instantiate extension (`createYnabExtension(fastify)(extApi)`).
4. Find tool by name from `extApi._tools`.
5. Execute with params and assert on result text or mock calls.

## Migration Order

1. Create `ynab/formatters.ts` and `ynab/utils.ts`.
2. Create the 7 tool files.
3. Rewrite `ynab/index.ts` to import and register all tools.
4. Delete old `ynab.ts` and `ynab-utils.ts`.
5. Create `test-helpers.ts` and split tests into per-tool files.
6. Delete old `ynab.test.ts`.
7. Run `npm run typecheck` and `npm test`.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Import path breakage from `ynab-utils.ts` move | Update all imports in tool files and tests. `ynab/index.ts` has no external consumers except `agent/index.ts`, which imports `./extensions/ynab.js`. |
| Lost test coverage during split | Migrate every existing test assertion into the new per-tool files before deleting the monolith. |
| TypeBox inference lost in tool factories | Enforce the `paramsSchema` + `ToolDefinition<typeof paramsSchema>` pattern in every tool file. |
