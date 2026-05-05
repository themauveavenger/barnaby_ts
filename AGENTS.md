# Agent Configuration & Rules

## Scope & Stability

- This is a **personal, single-user project**. Breaking changes are acceptable without deprecation periods, migration guides, or backwards-compatibility shims as long as appropriate test coverage has been added to the current test suite.

## Dependency Management

- Use `npm --save-exact` when installing or updating dependencies.

## TypeScript

- Objects should have a well-defined type. Avoid `any`, type casting with `as unknown`, and `Record<string, unknown>` for objects with known shapes.
- Let TypeScript infer types where it can. Do not annotate literals.
- The `tsconfig.json` extends `@tsconfig/node24` and `@tsconfig/node-ts`, which enforce:
  - **`verbatimModuleSyntax`**: Use `import type` / `export type` for type-only imports/exports.
  - **`erasableSyntaxOnly`**: Do not use `enum`, `namespace`, or parameter properties in classes.
- Function signatures must have explicit return types to catch changes that have broken contracts.
- Do not reimplement types from 3rd party modules. Check if they export an appropriate type and use TypeScript's utility types to create a new type if you must derive a new type.

## Testing

- Prefer end-to-end (e2e) tests over narrow integration tests.
- Do not use supertest. Use Fastify's `inject()` with `vitest` for HTTP assertions.
- Use the command `npm run test:minimal` defined the package.json file when running tests instead of using `npx vitest`. This keeps output minimal and limited for agent use.

## Runtime

- Start the dev server with `tsx --env-file=./.env ./src/index.ts`. The `.env` file is gitignored.
- Node.js 24 is the current LTS release (codename Krypton). The `mise.toml` uses `node = 'lts'` which resolves to Node 24.
