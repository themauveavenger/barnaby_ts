# Agent Configuration & Rules

## Scope & Stability

- This is a **personal, single-user project**. Breaking changes are acceptable without deprecation periods, migration guides, or backwards-compatibility shims.

## Dependency Management

- Use `npm --save-exact` when installing or updating dependencies.

## TypeScript

- Objects should have a well-defined type. Avoid `any`, type casting with `as unknown`, and `Record<string, unknown>` for objects with known shapes.
- Let TypeScript infer types where it can. Do not annotate literals or obvious return types.
- The `tsconfig.json` extends `@tsconfig/node24` and `@tsconfig/node-ts`, which enforce:
  - **`verbatimModuleSyntax`**: Use `import type` / `export type` for type-only imports/exports.
  - **`erasableSyntaxOnly`**: Do not use `enum`, `namespace`, or parameter properties in classes.
  - **`rewriteRelativeImportExtensions`**: Use `.ts` extensions on relative imports (e.g., `import { foo } from './foo.ts'`).

## Testing

- Prefer end-to-end (e2e) tests over narrow integration tests.
- Do not use supertest. Use native `fetch` with `vitest` for HTTP assertions.

## Runtime

- Start the dev server with `tsx --env-file=./.env ./src/index.ts`. The `.env` file is gitignored.
