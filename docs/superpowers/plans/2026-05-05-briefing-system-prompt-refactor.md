# Briefing System Prompt Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize Barnaby's personality into a shared module, move briefing task instructions from system prompt to user prompt, and explicitly instruct the agent to use the calendar tool.

**Architecture:** Extract `BARNABY_PERSONALITY` string into `src/agent/personality.ts`, consume it from both the shared agent plugin and the briefing service. The briefing service keeps creating its own `ResourceLoader` (to isolate the calendar extension) but uses the shared system prompt. All output rules, formatting constraints, and the example move into the user prompt.

**Tech Stack:** TypeScript, Fastify, vitest, `@mariozechner/pi-coding-agent`

---

### Task 1: Create Shared Personality Module

**Files:**
- Create: `src/agent/personality.ts`

- [ ] **Step 1: Write `src/agent/personality.ts`**

```ts
export const BARNABY_PERSONALITY =
  'You are Barnaby, a friendly personal assistant for your user. ' +
  'You are warm, casual, and efficient. Write like a helpful friend, not an administrative assistant. ' +
  'Answer clearly, concisely, and in plain language. ' +
  'Do not write or explain code unless the user explicitly asks for it.';
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/personality.ts
git commit -m "feat: add shared Barnaby personality module"
```

---

### Task 2: Update Agent Plugin to Use Shared Personality

**Files:**
- Modify: `src/plugins/agent/index.ts`

- [ ] **Step 1: Update imports and systemPrompt**

Replace the inline system prompt string with an import and reference to `BARNABY_PERSONALITY`:

```ts
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { AuthStorage, ModelRegistry, DefaultResourceLoader } from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import type { Model } from "@mariozechner/pi-ai";
import { BARNABY_PERSONALITY } from "../../agent/personality.js";
import createCalendarExtension from "./extensions/google-calendar.js";
import createYnabExtension from "./extensions/ynab/index.js";
import createTelegramExtension from "./extensions/telegram.js";

export type AgentServices = {
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  model: Model<any>;
  resourceLoader: DefaultResourceLoader;
};

export default fp(async function agentPlugin(fastify: FastifyInstance) {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = getModel("opencode-go", "minimax-m2.7");

  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: "/dev/null",
    noContextFiles: true,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories: [createCalendarExtension(fastify), createYnabExtension(fastify), createTelegramExtension(fastify)],
    systemPrompt: BARNABY_PERSONALITY,
  });
  await resourceLoader.reload();

  fastify.decorate("agent", { authStorage, modelRegistry, model, resourceLoader });
});
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/plugins/agent/index.ts
git commit -m "refactor: use shared personality in agent plugin"
```

---

### Task 3: Refactor Briefing Service

**Files:**
- Modify: `src/services/briefing.ts`

- [ ] **Step 1: Replace `buildSystemPrompt()` with shared import and move instructions to user prompt**

The full new content of `src/services/briefing.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { createAgentSession, DefaultResourceLoader, SessionManager } from '@mariozechner/pi-coding-agent';
import { AsyncTask, CronJob } from 'toad-scheduler';
import { BARNABY_PERSONALITY } from '../agent/personality.js';
import createCalendarExtension from '../plugins/agent/extensions/google-calendar.js';
import type { Memory } from "../plugins/repository.js";

export type BriefingService = {
  sendBriefing(options?: { triggerType?: 'scheduled' | 'manual' }): Promise<void>;
};

function getTimeOfDay(hour: number): string {
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function formatMemoryList(memories: Pick<Memory, "content">[]): string {
  return memories.map((m) => `- ${m.content}`).join('\n');
}

export function createBriefingService(fastify: FastifyInstance): BriefingService {
  return {
    async sendBriefing(options = {}) {
      const chatIdEnv = process.env.TELEGRAM_CHAT_ID;
      if (!chatIdEnv) {
        fastify.log.warn('TELEGRAM_CHAT_ID is not set, skipping briefing');
        return;
      }

      const chatId = Number(chatIdEnv);
      const triggerType = options.triggerType ?? 'scheduled';

      try {
        const { authStorage, modelRegistry, model } = fastify.agent;

        const resourceLoader = new DefaultResourceLoader({
          cwd: process.cwd(),
          agentDir: '/dev/null',
          noContextFiles: true,
          noExtensions: true,
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          extensionFactories: [
            createCalendarExtension(fastify),
          ],
          systemPrompt: BARNABY_PERSONALITY,
        });
        await resourceLoader.reload();

        const { session } = await createAgentSession({
          model,
          authStorage,
          modelRegistry,
          resourceLoader,
          sessionManager: SessionManager.inMemory(),
        });

        try {
          const now = new Date();
          const today = now.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          });
          const timeOfDay = getTimeOfDay(now.getHours());

          const previousBriefing = fastify.briefingRepository.findLatest();
          const previousContext = previousBriefing
            ? `\n\nHere is your previous briefing from ${new Date(previousBriefing.triggeredAt).toLocaleDateString('en-US')} for reference. Try not to repeat the same information unless it is still relevant:\n\n${previousBriefing.content}`
            : '';

          const coreMemories = fastify.memoryRepository.findByTags(['core'], { permanentOnly: true });
          const recentMemories = fastify.memoryRepository.findRecent(7);

          const coreContext = coreMemories.length > 0
            ? `Core memories about the user:\n${formatMemoryList(coreMemories)}`
            : '';

          const recentContext = recentMemories.length > 0
            ? `Recent notes and tasks (last 7 days):\n${formatMemoryList(recentMemories)}`
            : '';

          const memoryContext = [coreContext, recentContext].filter(Boolean).join('\n\n');

          const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
          const startIso = startOfDay.toISOString();
          const endIso = endOfDay.toISOString();

          const prompt = [
            `Today is ${today}. It is currently ${timeOfDay}.`,
            '',
            memoryContext,
            '',
            'INSTRUCTIONS:',
            '- Use the calendar_list tool to fetch today\'s events from the primary calendar.',
            `  Use start: "${startIso}" and end: "${endIso}".`,
            '- Generate a daily briefing based on those events and the notes above.',
            '- Start with a brief, warm greeting referencing the time of day.',
            '- Use 2-3 short paragraphs total, max 150 words.',
            '- Use a single bullet list only for 3+ calendar events; otherwise weave them into sentences.',
            '- If no calendar events exist today, do not mention the calendar at all.',
            '- If no memories or tasks exist, do not mention them at all.',
            '- Do not mention core memories unless the user explicitly asks you about them.',
            '- Never apologize for lack of information; just provide what you have.',
            '- If a tool returns an error, mention it briefly in plain English and move on.',
            '- Do not use emojis.',
            '- End with one brief, encouraging closing line.',
            '',
            'TONE: Casual, warm, and efficient. Avoid robotic lists. Write like a helpful friend.',
            previousContext,
          ].filter((s) => s !== '').join('\n');

          fastify.log.debug({ prompt }, "Built briefing prompt");

          await session.prompt(prompt);
          const responseText = session.getLastAssistantText() ?? '';

          await fastify.telegramClient.sendMessage(chatId, responseText);

          fastify.briefingRepository.create({
            content: responseText,
            triggerType,
          });
        } finally {
          session.dispose();
        }
      } catch (error) {
        fastify.log.error(error, 'Failed to send briefing');
      }
    },
  };
}

export function registerBriefingJob(fastify: FastifyInstance): void {
  const briefingService = createBriefingService(fastify);
  const cronExpression = process.env.BRIEFING_CRON;

  if (!cronExpression) {
    fastify.log.warn('BRIEFING_CRON is not set, skipping briefing job registration');
    return;
  }

  const task = new AsyncTask(
    'briefing-task',
    async () => {
      await briefingService.sendBriefing();
    },
    (err: Error) => {
      fastify.log.error(err, 'Briefing cron task failed');
    }
  );

  const job = new CronJob(
    { cronExpression },
    task,
    { id: 'briefing-job', preventOverrun: true }
  );

  fastify.scheduler.addCronJob(job);
}
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/briefing.ts
git commit -m "refactor: move briefing instructions to user prompt and use shared personality"
```

---

### Task 4: Update Unit Tests for Briefing Service

**Files:**
- Modify: `test/services/briefing.test.ts`

- [ ] **Step 1: Update assertions for system prompt and user prompt**

In `test/services/briefing.test.ts`, update the first test (`creates agent session with improved system prompt and sends result to Telegram`) to reflect the new behavior:

Change these assertions:
```ts
      expect(resourceLoaderCall.systemPrompt).toContain('You are Barnaby');
      expect(resourceLoaderCall.systemPrompt).toContain('EXAMPLE');
      expect(resourceLoaderCall.systemPrompt).toContain('Only use information provided by the tools');
      expect(resourceLoaderCall.systemPrompt).toContain('If a tool returns an error');
      expect(resourceLoaderCall.systemPrompt).toContain('Do not use emojis');
```

To:
```ts
      expect(resourceLoaderCall.systemPrompt).toContain('You are Barnaby');
      expect(resourceLoaderCall.systemPrompt).toContain('friendly personal assistant');
      expect(resourceLoaderCall.systemPrompt).not.toContain('EXAMPLE');
      expect(resourceLoaderCall.systemPrompt).not.toContain('Only use information provided by the tools');
      expect(resourceLoaderCall.systemPrompt).not.toContain('If a tool returns an error');
      expect(resourceLoaderCall.systemPrompt).not.toContain('Do not use emojis');
```

Add assertions that the user prompt now contains the instructions and calendar tool call:

```ts
      const prompt = mockSession.prompt.mock.calls[0][0];
      expect(prompt).toContain('Use the calendar_list tool');
      expect(prompt).toContain('Generate a daily briefing');
      expect(prompt).toContain('Start with a brief, warm greeting');
      expect(prompt).toContain('max 150 words');
      expect(prompt).toContain('Do not use emojis');
```

Also verify the prompt contains the ISO date range for today:
```ts
      expect(prompt).toMatch(/start: "\d{4}-\d{2}-\d{2}T00:00:00\.000Z"/);
      expect(prompt).toMatch(/end: "\d{4}-\d{2}-\d{2}T00:00:00\.000Z"/);
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run test/services/briefing.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/services/briefing.test.ts
git commit -m "test: update assertions for refactored briefing prompts"
```

---

### Task 5: Run Full Test Suite

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (including briefing route tests).

- [ ] **Step 2: Commit if tests pass**

No additional files to commit if only test expectations were adjusted.

---

## Spec Coverage Check

| Spec Requirement | Plan Task |
|---|---|
| Create shared personality module | Task 1 |
| Agent plugin uses shared personality | Task 2 |
| Briefing service removes inline `buildSystemPrompt()` | Task 3 |
| Briefing service uses shared `BARNABY_PERSONALITY` | Task 3 |
| Task instructions move to user prompt | Task 3 |
| Explicit calendar tool instruction in user prompt | Task 3 |
| Tests updated | Task 4 |

## Placeholder Scan

No placeholders found. All steps include exact code, exact file paths, and exact commands.

## Type Consistency Check

- `BARNABY_PERSONALITY` is a `string` exported from `src/agent/personality.ts`.
- `systemPrompt` option on `DefaultResourceLoader` accepts `string`.
- `createBriefingService` return type (`BriefingService`) is unchanged.
- `sendBriefing` signature is unchanged.

All consistent.
