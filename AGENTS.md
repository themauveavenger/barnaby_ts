# Agent Configuration & Rules

## Scope & Stability

- This is a **personal, single-user project**. Breaking changes are acceptable without deprecation periods, migration guides, or backwards-compatibility shims.

## Dependency Management

- Use `npm`
- Use `--save-exact` when installing or updating dependencies to pin exact versions

## Coding Standards

### Typescript

- Objects should have a well-defined type
- Avoid using `any`
- Avoid type casting using `as unknown`
- Avoid using `Record<string, unknown>` when you don't know the exact the shape of an object.
  - Either look up the type you want yourself in the respective module or delegate to a subagent to find it while you
    work on something else.
  - In most cases, use of `Record` should be reserved for objects whose values all share the same type.
- Let TypeScript infer types where it can. You don't need to add a type to everything. 
```typescript
const someFunction = (): number => { return 1 + 1 };

// good
const someStr = "I am a banana!"
const two = someFunction();

// bad 
const someOtherStr: string = "I am a silly banana!"
const otherTwo: number = someFunction();
```

## Testing

- Prefer end-to-end (e2e) tests over individual integration tests that test only one controller/orchestrator.
- Do not use supertest in tests. Prefer native `fetch` and use `vitest` for response validation.