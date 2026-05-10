# Package Agent Extensions for Pi CLI

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Barnaby agent extensions (`weather`, `google-calendar`, `telegram`, `ynab`, `memory`, `google-drive`) usable from the Pi CLI as interactive agent tools. Currently they're tightly coupled to Fastify — each extension is a factory-of-factories that receives a `FastifyInstance` and uses its decorators for data access. Pi CLI extensions must be simple `(pi: ExtensionAPI) => void` default exports. We need to decouple the domain logic from Fastify, create standalone entry points, and package them for `pi install`.

**Architecture:** Each extension will get a standalone entry point alongside the existing Barnaby entry point. Shared domain logic (formatters, API call construction, response types) stays in importable modules. The Barnaby entry injects Fastify services; the Pi CLI entry creates clients from environment variables. All standalone entries are bundled into a single `barnaby-pi-extensions` package published via git.

**Tech Stack:** Node.js 24, TypeScript, Pi extension API, `@earendil-works/pi-coding-agent`, `typebox`

---

## The Core Problem

Current extensions follow a **factory-of-factory** pattern:

```typescript
// Current: createXExtension(fastify) → ExtensionFactory → (pi) => { ... }
export default function createWeatherExtension(fastify: FastifyInstance): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    // registers tools that call fastify.*, fastify.log, fastify.timezone, etc.
  };
}
```

Pi CLI extensions must be:

```typescript
export default function weatherExtension(pi: ExtensionAPI) {
  // registers tools that create their own clients from env vars
}
```

Each extension calls `fastify.*` decorators (`fastify.ynabClient`, `fastify.telegramClient`, `fastify.googleAuth`, `fastify.timezone`, `fastify.memoryRepository`, `fastify.log`) for data access. These need to be replaced with standalone clients or env-var-driven alternatives.

---

## Package Structure

Single monorepo package (all extensions are personal tools — simpler install, one config location):

```
barnaby-pi-extensions/
├── package.json           # pi manifest, peerDependencies
├── tsconfig.json          # extends root, targets ESM
└── extensions/
    ├── weather.ts
    ├── google-calendar.ts
    ├── telegram.ts
    ├── google-drive.ts
    ├── memory.ts
    └── ynab/
        ├── index.ts
        ├── tools/
        │   ├── ynab-get-transactions.ts
        │   ├── ynab-create-transaction.ts
        │   ├── ynab-split-transaction.ts
        │   ├── ynab-approve-transaction.ts
        │   ├── ynab-delete-transaction.ts
        │   ├── ynab-flag-transaction.ts
        │   └── ynab-get-payee-history.ts
        ├── formatters.ts
        └── utils.ts
```

### `package.json`

```jsonc
{
  "name": "barnaby-pi-extensions",
  "version": "1.0.0",
  "private": true,
  "keywords": ["pi-package"],
  "dependencies": {
    // Only runtime deps the extensions need directly
    // e.g. "ynab": "^3.0.0" if the YNAB SDK is used
  },
  "peerDependencies": {
    // Pi bundles these — don't duplicate them
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-tui": "*",
    "typebox": "*"
  },
  "pi": {
    "extensions": ["./extensions"]
  }
}
```

### Installation and Usage

```bash
# From local path (during development)
pi install /home/josh/Code/node/barnaby_ts/barnaby-pi-extensions

# Quick test with -e flag
pi -e /home/josh/Code/node/barnaby_ts/barnaby-pi-extensions/extensions/weather.ts

# Once published to GitHub
pi install git:github.com/josh/barnaby-pi-extensions
```

---

## Extension-by-Extension Refactoring Plan

### Weather

**Current dependencies on Fastify:** `fastify.timezone`, `fastify.log`

**Standalone approach:**
- Replace `fastify.timezone` with `process.env.TIMEZONE ?? "America/New_York"`
- Replace `fastify.log.warn` / `fastify.log.error` with console output (Pi extensions don't have a Fastify logger)
- `formatWeatherSummary` and response types are already in `src/plugins/weather-formatter.ts` — importable directly

**Env vars:** `WEATHER_LATITUDE`, `WEATHER_LONGITUDE`, `TIMEZONE` (optional)

---

### Telegram

**Current dependencies on Fastify:** `fastify.telegramClient.sendMessage(chatId, text)`

**Standalone approach:**
- Import the Telegram Bot API client directly or use `fetch` against the Telegram Bot API
- Env vars: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- The tool already reads `TELEGRAM_CHAT_ID` from env; we just need to swap `fastify.telegramClient` for a direct API call

**Env vars:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

---

### Google Calendar

**Current dependencies on Fastify:** `fastify.googleAuth.oauth2Client`, `fastify.timezone`

**Standalone approach:**
- Google OAuth is the hardest part. Options:
  1. **Shared credentials file** — Read a token file from `~/.config/barnaby/google-oauth.json` (or similar). The Barnaby server refreshes tokens; the Pi extension reads the cached token.
  2. **Service account** — If using a service account, auth is simpler (just a JSON key file).
  3. **Env var token** — Store the refresh token in an env var and let the extension handle refresh.
- The `calendar-client.ts` module already encapsulates Google Calendar API calls — we'd create a standalone version that constructs its own OAuth2 client
- Replace `fastify.timezone` with `process.env.TIMEZONE ?? "America/New_York"`

**Env vars:** `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`, `TIMEZONE` (or a shared token file path)

**Key decision needed:** How to handle Google OAuth in a CLI context. The Barnaby server has an OAuth flow; the Pi CLI extension needs a way to get a valid token. Most likely: the Barnaby server writes tokens to a file, and the Pi extension reads from that file.

---

### Google Drive

**Current dependencies on Fastify:** `fastify.googleAuth.oauth2Client`, `createDriveClient(fastify.googleAuth.oauth2Client)`

**Standalone approach:**
- Same OAuth challenge as Google Calendar
- The `drive-client.ts` module wraps Google Drive API calls — create a standalone version
- Shares the same OAuth solution as Calendar (likely: shared token file)

**Env vars:** Same OAuth config as Calendar

---

### YNAB

**Current dependencies on Fastify:** `fastify.ynabClient.api` (the `ynab` SDK instance)

**Standalone approach:**
- Create the YNAB API client directly: `new ynab.API(process.env.YNAB_ACCESS_TOKEN)`
- The individual tool files already import from `../utils.js` and `../formatters.ts` — pure formatting and utility functions, no Fastify dependency
- Tool files take `fastify: FastifyInstance` and use `fastify.ynabClient.api` — we'd create a parallel entry that constructs its own `ynab.API`

**Env vars:** `YNAB_ACCESS_TOKEN`

---

### Memory

**Current dependencies on Fastify:** `fastify.memoryRepository` (a database-backed repository)

**Standalone approach:**
- This is the trickiest one. The memory extension uses `fastify.memoryRepository` which is a Fastify plugin backed by a database
- Options:
  1. **File-based storage** — Use `pi.appendEntry()` for state persistence (the Pi-native way). Reconstruct state from session entries on `session_start`.
  2. **Same database, direct connection** — Connect to the same database (SQLite/Postgres) that the Barnaby server uses, without Fastify
  3. **REST API** — The Barnaby server could expose memory endpoints that the Pi extension calls
- The memory categories and guidelines are in `src/memory-categories.ts` and `src/agent/memory-guidelines.ts` — these are pure data, already importable
- Tool definitions use `Type.Union` for categories which Pi documentation says doesn't work with Google's API — should switch to `StringEnum` from `@earendil-works/pi-ai`

**Env vars:** Depends on storage approach. For file-based: none needed. For direct DB: `DATABASE_URL` etc.

**Key decision needed:** Memory storage backend in standalone context.

---

## Architecture: Shared Modules + Dual Entry Points

The cleanest approach is **shared domain modules + dual entry points**:

```
src/plugins/agent/extensions/
├── weather.ts                    # Barnaby entry (takes fastify)
├── google-calendar.ts            # Barnaby entry (takes fastify)
├── telegram.ts                   # Barnaby entry (takes fastify)
├── google-drive.ts               # Barnaby entry (takes fastify)
├── memory.ts                     # Barnaby entry (takes fastify)
└── ynab/
    ├── index.ts                  # Barnaby entry (takes fastify)
    ├── tools/
    │   ├── ynab-get-transactions.ts   # Barnaby tool (takes fastify)
    │   └── ...
    ├── formatters.ts             # Shared: pure formatting logic
    └── utils.ts                  # Shared: pure utility logic

barnaby-pi-extensions/
└── extensions/
    ├── weather.ts                # Pi CLI entry (env vars)
    ├── google-calendar.ts        # Pi CLI entry (env vars + shared token)
    ├── telegram.ts               # Pi CLI entry (env vars)
    ├── google-drive.ts           # Pi CLI entry (env vars + shared token)
    ├── memory.ts                 # Pi CLI entry (pi.appendEntry or DB)
    └── ynab/
        ├── index.ts              # Pi CLI entry (env vars)
        ├── tools/
        │   ├── ynab-get-transactions.ts  # Pi CLI tool (creates ynab client)
        │   └── ...
        ├── formatters.ts         # Re-exported or symlinked from shared
        └── utils.ts              # Re-exported or symlinked from shared
```

The **shared** modules (`formatters.ts`, `utils.ts`, `weather-formatter.ts`, `calendar-client.ts`, `drive-client.ts`) contain pure data processing and API call logic with no Fastify dependency. Both entry points import from these shared modules.

For duplication avoidance, the Pi CLI package could either:
1. **Import from the main project** — `"formatters": "../../src/plugins/agent/extensions/ynab/formatters.js"` (works during development, fragile for published package)
2. **Copy the shared modules** — Duplicate the pure-logic files into `barnaby-pi-extensions/` (clean separation, but drift risk)
3. **Extract to a shared package** — Create `barnaby-shared` that both the Barnaby server and Pi extensions import (most modular, but more setup)

**Recommendation:** Start with option 2 (copy) for simplicity. The shared modules are small and stable — we can extract to a shared package later if drift becomes a problem.

---

## Refactored Extension Pattern

Here's what a standalone extension looks like:

```typescript
// barnaby-pi-extensions/extensions/weather.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { formatWeatherSummary, /* ... */ } from "./shared/weather-formatter.js";

export default function weatherExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "get_weather_forecast",
    label: "Get Weather Forecast",
    description: "Fetches today's weather forecast and air quality...",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params) {
      const latitude = process.env.WEATHER_LATITUDE;
      const longitude = process.env.WEATHER_LONGITUDE;
      const timezone = process.env.TIMEZONE ?? "America/New_York";

      if (!latitude || !longitude) {
        return {
          content: [{ type: "text" as const, text: "Error: Set WEATHER_LATITUDE and WEATHER_LONGITUDE." }],
          details: {},
        };
      }

      // Direct fetch calls — no Fastify dependency
      const [forecastRes, aqRes] = await Promise.all([
        fetch(`${FORECAST_URL}?${forecastParams.toString()}`),
        fetch(`${AIR_QUALITY_URL}?${aqParams.toString()}`),
      ]);

      // ...
      const text = formatWeatherSummary(forecast, airQuality, today, timezone);
      return { content: [{ type: "text" as const, text }], details: {} };
    },
  });
}
```

Key differences from the Barnaby version:
- **No `FastifyInstance` parameter** — creates clients from env vars
- **Default export is the factory directly** — not a factory-of-factories
- **Uses `@earendil-works/pi-coding-agent`** — the public package name (not `@mariozechner/pi-coding-agent`)
- **Uses `StringEnum` from `@earendil-works/pi-ai`** for enum parameters (Google API compatibility)
- **Uses `process.env.TIMEZONE`** instead of `fastify.timezone`

---

## Steps

### Task 1: Create the package directory

- [ ] Create `barnaby-pi-extensions/` at project root
- [ ] Create `package.json` with pi manifest and dependencies
- [ ] Create `tsconfig.json` extending the root config
- [ ] Create `extensions/` directory structure

### Task 2: Extract shared domain modules

- [ ] Identify pure-logic functions in each extension that have no Fastify dependency
- [ ] Copy shared modules (formatters, utils, response types) into `barnaby-pi-extensions/extensions/`
- [ ] Ensure shared modules import only from standard libraries or env vars (no Fastify)

### Task 3: Create standalone entry points

For each extension:
- [ ] **weather.ts** — Replace `fastify.timezone` with `process.env.TIMEZONE`, replace `fastify.log.*` with console
- [ ] **telegram.ts** — Replace `fastify.telegramClient` with direct Telegram Bot API `fetch` calls using `TELEGRAM_BOT_TOKEN` env var
- [ ] **google-calendar.ts** — Create standalone OAuth2 client from env vars or shared token file; import shared formatter logic
- [ ] **google-drive.ts** — Same OAuth approach as calendar; import shared drive-client logic
- [ ] **memory.ts** — Decide on storage backend (file-based via `pi.appendEntry`, direct DB, or REST API); extract category/guideline data which is already pure
- [ ] **ynab/** — Create standalone ynab client from `YNAB_ACCESS_TOKEN` env var; copy formatters and utils

### Task 4: Fix Pi compatibility issues

- [ ] Change import from `@mariozechner/pi-coding-agent` to `@earendil-works/pi-coding-agent`
- [ ] Change `ExtensionFactory` type usage — standalone entries export `(pi: ExtensionAPI) => void` directly, not a factory-of-factories
- [ ] Replace `Type.Union` with `StringEnum` from `@earendil-works/pi-ai` (e.g., in memory categories)
- [ ] Add `promptSnippet` and `promptGuidelines` to tools that don't have them yet

### Task 5: Test locally

- [ ] Install locally: `pi install ./barnaby-pi-extensions`
- [ ] Test each extension with `pi -e ./barnaby-pi-extensions/extensions/weather.ts`
- [ ] Verify environment variable configuration works
- [ ] Test all tools in an interactive session

### Task 6: Publish to GitHub (optional)

- [ ] Create a separate repository or add as a subtree
- [ ] Install via `pi install git:github.com/josh/barnaby-pi-extensions`
- [ ] Verify auto-install works on a fresh machine

---

## Open Questions

1. **Google OAuth in CLI context** — The Barnaby server has a full OAuth flow with token refresh. How should Pi CLI extensions get valid Google tokens? Options: shared token file, service account, or env var refresh token.
2. **Memory storage backend** — Should standalone memory use `pi.appendEntry()` for session persistence, connect directly to the same database, or call the Barnaby API?
3. **Package location** — Should `barnaby-pi-extensions/` live in this repo (as a subdirectory) or in its own repo? In-repo is simpler for development but means `pi install` paths reference the monorepo.
4. **Shared module strategy** — Copy vs. symlink vs. shared package. Copy is simplest to start; we can extract later.
5. **Package name** — `@mariozechner/pi-coding-agent` vs `@earendil-works/pi-coding-agent` — need to confirm which is the correct public package name for peer dependencies.