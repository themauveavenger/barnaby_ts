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

## Pattern Matching (ts-pattern)

- Use `ts-pattern` (`match`/`P`) instead of `switch` statements or long `if`/`else if` chains when mapping a value to a result.
- Use `.with()` with multiple pattern arguments for multi-value cases (e.g. `.with(45, 48, () => "Fog")` instead of fallthrough `case` blocks).
- Use `P.when()` for range/predicate-based matching (e.g. `.with(P.when((n) => n <= 50), () => "Good")`).
- Use `.otherwise()` for default/fallback branches. Use `.exhaustive()` only when every possible case must be handled and a missing case should be a type error.
- Prefer `match` over ternary expressions when branching on a nullable value — `.with(null, ...).otherwise(...)` narrows the type in the handler and avoids nested `? :`.
- Do **not** use `match` for simple two-branch booleans, procedural `let`-mutation inside `if`/`else` blocks, or cases where a plain `if` is clearer. Pattern matching should improve readability, not add indirection.

## Linting

- ESLint 10 with flat config (`eslint.config.js`). Run `npm run lint` to check, `npm run lint:fix` to auto-fix.
- The config enforces: single quotes, semicolons, no trailing commas, no unused vars (allow `_` prefix), no `any` or `Function` types in source code.
- Test files (`test/**/*.ts`) are relaxed: `any` and `Function` types are allowed for mock flexibility.
- Lint must pass with zero errors before any feature work is considered done — alongside `npm run typecheck` and `npm run test:minimal`.

## Testing

- Prefer end-to-end (e2e) tests over narrow integration tests.
- Do not use supertest. Use Fastify's `inject()` with `vitest` for HTTP assertions.
- Use the command `npm run test:minimal` defined the package.json file when running tests instead of using `npx vitest`. This keeps output minimal and limited for agent use.

## Shell Scripts & Heredocs

- The deploy script (`scripts/deploy.sh`) uses an **unquoted heredoc** (`<<REMOTE`) to send a script to a remote host via `ssh`. The local shell expands `$VAR` and `${VAR}` before transmission.
- Variables meant for the **remote shell** must be escaped: `\${VAR}`, `\$VAR`, `\$(cmd)`. Unescaped references are evaluated locally and will either use wrong values or fail under `set -u` with "unbound variable".
- Variables meant for the **local shell** (e.g. `${PI_HOST}`, `${DOMAIN}`) are intentionally unescaped.
- When editing code inside an unquoted heredoc, **always check every `$` and `${}`** — if it's a remote variable, escape it with a backslash.
- A quoted heredoc (`<<'REMOTE'`) would disable all local expansion. This project deliberately uses unquoted to inject local variables, so the escaping discipline is required.

## Runtime

- Start the dev server with `tsx --env-file=./.env ./src/index.ts`. The `.env` file is gitignored.
- Node.js 24 is the current LTS release (codename Krypton). The `mise.toml` uses `node = 'lts'` which resolves to Node 24.
