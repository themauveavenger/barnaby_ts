# Extract YNAB Pi Extension to Standalone Repository

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Barnaby's YNAB Pi extension from `src/plugins/agent/extensions/ynab/` into a new standalone git repository at `~/Code/node/pi-extension-for-ynab`, then consume that package from Barnaby. The extracted package must work both as an installable Pi package for interactive TUI sessions and as an importable dependency for Barnaby's existing `DefaultResourceLoader` `extensionFactories` flow.

**Architecture:** The new package exposes two extension entry points from one codebase:

- default export: direct Pi extension function for Pi package loading, `default function ynabExtension(pi: ExtensionAPI): void`
- named export: configurable factory for embedding, `createYnabExtension(options?) => (pi: ExtensionAPI) => void`

The default export creates a YNAB client from `process.env.YNAB_PERSONAL_ACCESS_TOKEN`. Barnaby imports the named factory and no longer owns a Fastify YNAB client plugin.

**Tech Stack:** Node.js 24, TypeScript, ESM, Pi extension API, `ynab`, `typebox`, `tsx`, ESLint, Vitest if tests are added.

---

## Key Decisions

- Repository name: `pi-extension-for-ynab`
- Repository path: `/home/josh/Code/node/pi-extension-for-ynab`
- Package name: `pi-extension-for-ynab`
- Token env var: `YNAB_PERSONAL_ACCESS_TOKEN` only; do not support `YNAB_ACCESS_TOKEN` fallback.
- Build output: `dist/`
- GitHub install support: use `prepare` to build during install; do not commit `dist/` initially.
- Versioning: tag releases, starting with `v0.1.0`.
- Runtime package loading: include a `pi` manifest in `package.json`.
- Local development in Barnaby: start with `file:../pi-extension-for-ynab`, then switch to a GitHub tag after the new repo is pushed/tagged.

---

## New Package Shape

```txt
/home/josh/Code/node/pi-extension-for-ynab/
├── .env.example
├── .gitignore
├── eslint.config.js
├── package.json
├── package-lock.json
├── README.md
├── tsconfig.json
├── vitest.config.ts              # only if tests are added
└── src/
    ├── index.ts
    ├── ynab-client.ts
    ├── formatters.ts
    ├── utils.ts
    └── tools/
        ├── ynab-approve-transaction.ts
        ├── ynab-create-transaction.ts
        ├── ynab-delete-transaction.ts
        ├── ynab-flag-transaction.ts
        ├── ynab-get-payee-history.ts
        ├── ynab-get-transactions.ts
        └── ynab-split-transaction.ts
```

### `package.json` requirements

```jsonc
{
  "name": "pi-extension-for-ynab",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist", "README.md", ".env.example"],
  "keywords": ["pi-package"],
  "scripts": {
    "build": "tsc",
    "prepare": "npm run build",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "pi": {
    "extensions": ["./dist/index.js"]
  },
  "dependencies": {
    "currency.js": "<exact version>",
    "date-fns": "<exact version>",
    "mathjs": "<exact version>",
    "ynab": "<exact version>"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "typebox": "*"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "<exact version>",
    "typebox": "<exact version>",
    "typescript": "<exact version>",
    "tsx": "<exact version>",
    "eslint": "<exact version>",
    "vitest": "<exact version if tests are added>"
  }
}
```

Notes:

- Per Pi package docs, Pi-bundled imports such as `@earendil-works/pi-coding-agent` and `typebox` should be peer dependencies with `"*"`, not bundled runtime dependencies.
- Keep them in `devDependencies` too so the standalone repo can typecheck and lint locally.
- Use `npm --save-exact` when installing dependencies.

### `.gitignore`

```gitignore
node_modules/
dist/
.env
.env.*
!.env.example
```

### `.env.example`

```env
YNAB_PERSONAL_ACCESS_TOKEN=
```

---

## Public API

`src/index.ts` should expose both direct Pi package usage and Barnaby embedding:

```typescript
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export interface YnabExtensionOptions {
  accessToken?: string;
  ynabClient?: YnabClient;
  ynabAPI?: ynab.API;
}

export function createYnabExtension(options?: YnabExtensionOptions) {
  return (pi: ExtensionAPI): void => {
    // create/resolve client, register all tools
  };
}

export default function ynabExtension(pi: ExtensionAPI): void {
  return createYnabExtension()(pi);
}

export { YnabClient } from './ynab-client.js';
export { createYnabClientFromEnv } from './ynab-client.js';
```

The exact `YnabExtensionOptions` can be simplified during implementation, but keep these constraints:

- Default export must be directly callable by Pi as `(pi: ExtensionAPI) => void`.
- Named `createYnabExtension()` must return the extension factory Barnaby passes to `DefaultResourceLoader`.
- The default env-backed path must throw a clear error if `YNAB_PERSONAL_ACCESS_TOKEN` is absent.

---

## Implementation Plan

- [ ] Read current YNAB extension files in `src/plugins/agent/extensions/ynab/` and current Barnaby registration in `src/plugins/agent/index.ts`.
- [ ] Create `/home/josh/Code/node/pi-extension-for-ynab` and initialize a new git repo.
- [ ] Add package scaffolding: `package.json`, `tsconfig.json`, `eslint.config.js`, `.gitignore`, `.env.example`, and `README.md`.
- [ ] Install exact dependencies/devDependencies, mirroring Barnaby's TypeScript/ESLint/tsx setup where appropriate.
- [ ] Copy YNAB extension source files from Barnaby into the new repo's `src/` layout.
- [ ] Move Barnaby's current `src/plugins/ynab-client.ts` functionality into `src/ynab-client.ts`, removing all Fastify plugin/decorator behavior.
- [ ] Refactor every tool to accept a YNAB API/client dependency instead of `FastifyInstance` or `fastify.ynabClient.api`.
- [ ] Implement `createYnabExtension(options?)` and the direct default export in `src/index.ts`.
- [ ] Add README usage examples for both Pi TUI and Barnaby embedding.
- [ ] Run new package checks: `npm run lint`, `npm run typecheck`, `npm run build`, and tests if present.
- [ ] In Barnaby, add the local dependency: `"pi-extension-for-ynab": "file:../pi-extension-for-ynab"`.
- [ ] Update Barnaby `src/plugins/agent/index.ts` to import `{ createYnabExtension }` from `pi-extension-for-ynab` and call `createYnabExtension()` in `extensionFactories`.
- [ ] Remove Barnaby's local YNAB extension directory once the package import works.
- [ ] Remove Barnaby's Fastify YNAB client plugin registration and type decoration if no longer used.
- [ ] Remove Barnaby dependencies that are now only needed by the YNAB extension, after verifying no other code imports them.
- [ ] Run Barnaby quality gate: `npm run lint && npm run typecheck && npm run test:minimal`.
- [ ] Commit the new repo and tag `v0.1.0`.
- [ ] After pushing the new repo, switch Barnaby from local `file:` dependency to a pinned GitHub tag, e.g. `github:<user>/pi-extension-for-ynab#v0.1.0`.

---

## Barnaby Integration Target

Current Barnaby code uses local extension factories in `src/plugins/agent/index.ts`:

```typescript
extensionFactories: [
  createCalendarExtension(fastify),
  createYnabExtension(fastify),
  createTelegramExtension(fastify),
  createMemoryExtension(fastify),
  createWeatherExtension(fastify),
  createGoogleDriveExtension(fastify)
]
```

Target shape:

```typescript
import { createYnabExtension } from 'pi-extension-for-ynab';

extensionFactories: [
  createCalendarExtension(fastify),
  createYnabExtension(),
  createTelegramExtension(fastify),
  createMemoryExtension(fastify),
  createWeatherExtension(fastify),
  createGoogleDriveExtension(fastify)
]
```

Barnaby should not need to construct or decorate a YNAB client. The standalone extension package owns YNAB auth and client creation.

---

## Pi TUI Usage Target

Local development:

```bash
cd /home/josh/Code/node/pi-extension-for-ynab
npm install
npm run build
pi -e /home/josh/Code/node/pi-extension-for-ynab
```

Installed package after GitHub push/tag:

```bash
pi install git:github.com/<user>/pi-extension-for-ynab@v0.1.0
```

Environment requirement:

```bash
export YNAB_PERSONAL_ACCESS_TOKEN=...
```

The user's shell already provides this via `.bashrc`; the extension should rely on that.

---

## Gotchas and Checks

- [ ] The default export cannot be a configurable factory requiring options; Pi package loading expects the loaded extension itself to be callable as `(pi: ExtensionAPI) => void`.
- [ ] Include the `pi` manifest. Without it, Pi may not know to load `dist/index.js` as the package extension.
- [ ] `prepare` must succeed when installing from GitHub. Test a real install path before considering the tag usable.
- [ ] Do not leave any `fastify`, `FastifyInstance`, or `fastify.ynabClient` imports/usages in the standalone package.
- [ ] If using the `ynab.API` type in public options, import the type from the `ynab` package instead of reimplementing it.
- [ ] Ensure `.env.example` is committed while real `.env` files are ignored.
- [ ] Confirm Barnaby no longer imports `ynab`, `currency.js`, `date-fns`, or `mathjs` before removing those dependencies from Barnaby.
- [ ] Pin Barnaby's GitHub dependency to a tag, not a branch.

---

## Validation Commands

New package:

```bash
cd /home/josh/Code/node/pi-extension-for-ynab
npm run lint
npm run typecheck
npm run build
npm test
```

Barnaby:

```bash
cd /home/josh/Code/node/barnaby_ts
npm run lint && npm run typecheck && npm run test:minimal
```

Git tagging:

```bash
cd /home/josh/Code/node/pi-extension-for-ynab
git tag v0.1.0
```
