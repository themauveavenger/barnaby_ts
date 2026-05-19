# Agent Configuration & Rules

## Scope & Stability

- This is a **personal, single-user project**. Breaking changes are acceptable without deprecation periods, migration guides, or backwards-compatibility shims as long as appropriate test coverage has been added to the current test suite.

## Dependency Management

- Use `npm --save-exact` when installing or updating dependencies.

## TypeScript

- Avoid type casting with `as unknown` and `Record<string, unknown>` for objects with known shapes. (`any` is already forbidden by the linter in source files.)
- Do not annotate literals — let TypeScript infer the type.
- Function signatures must have explicit return types.
- Import types from 3rd party modules instead of reimplementing them.

## Pattern Matching (ts-pattern)

- Use `ts-pattern` (`match`/`P`) instead of `switch` statements or long `if`/`else if` chains when mapping a value to a result.
- Use `.with()` with multiple pattern arguments for multi-value cases (e.g. `.with(45, 48, () => "Fog")` instead of fallthrough `case` blocks).
- Use `P.when()` for range/predicate-based matching (e.g. `.with(P.when((n) => n <= 50), () => "Good")`).
- Use `.otherwise()` for default/fallback branches. Use `.exhaustive()` only when every possible case must be handled and a missing case should be a type error.
- Prefer `match` over ternary expressions when branching on a nullable value — `.with(null, ...).otherwise(...)` narrows the type in the handler and avoids nested `? :`.
- Do **not** use `match` for simple two-branch booleans, procedural `let`-mutation inside `if`/`else` blocks, or cases where a plain `if` is clearer.

## Quality Gate

- All three must pass with zero errors before feature work is done:
  ```bash
  npm run lint && npm run typecheck && npm run test:minimal
  ```

## Testing

- Prefer end-to-end (e2e) tests over narrow integration tests.
- Do not use supertest. Use Fastify's `inject()` with `vitest` for HTTP assertions.

## Shell Scripts & Heredocs

- The deploy script (`scripts/deploy.sh`) uses an **unquoted heredoc** (`<<REMOTE`) to send a script to a remote host via `ssh`. The local shell expands `$VAR` and `${VAR}` before transmission.
- Variables meant for the **remote shell** must be escaped: `\${VAR}`, `\$VAR`, `\$(cmd)`. Unescaped references are evaluated locally and will either use wrong values or fail under `set -u` with "unbound variable".
- Variables meant for the **local shell** (e.g. `${PI_HOST}`, `${DOMAIN}`) are intentionally unescaped.
- When editing code inside an unquoted heredoc, **always check every `$` and `${}`** — if it's a remote variable, escape it with a backslash.
- A quoted heredoc (`<<'REMOTE'`) would disable all local expansion. This project deliberately uses unquoted to inject local variables, so the escaping discipline is required.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for this repo; use `gh` for issue operations. See `docs/agents/issue-tracker.md`.

### Triage labels

This repo uses the default five canonical triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `CONTEXT.md` plus `docs/adr/`. See `docs/agents/domain.md`.
