# Briefing System Prompt Refactor

## Date
2026-05-05

## Problem
The daily briefing service currently carries too much task-specific instruction in its system prompt, while the user prompt is too thin. This creates two issues:

1. **System prompt bloat**: Output rules, formatting constraints, word limits, and an example all live in the system prompt, mixing identity with task instructions.
2. **Missing tool instruction**: The prompt says "Generate the daily briefing" without explicitly telling the agent to fetch calendar events first, so it may skip the `calendar_list` tool call.
3. **Duplicate personality**: Chat and briefing define Barnaby's personality independently, risking inconsistency.

## Goals

- Move task-specific instructions from system prompt to user prompt.
- Centralize Barnaby's shared personality/identity so chat and briefing use the same voice.
- Explicitly instruct the agent to call the calendar tool before composing the briefing.
- Keep the minimax model for briefings (sufficient for structured tool call + composition).

## Design

### 1. Shared Personality Module

Create `src/agent/personality.ts`:

```ts
export const BARNABY_PERSONALITY =
  'You are Barnaby, a friendly personal assistant for your user. ' +
  'You are warm, casual, and efficient. Write like a helpful friend, not an administrative assistant. ' +
  'Answer clearly, concisely, and in plain language. ' +
  'Do not write or explain code unless the user explicitly asks for it.';
```

### 2. Agent Plugin (`src/plugins/agent/index.ts`)

Use `BARNABY_PERSONALITY` as the system prompt for the shared agent resource loader:

```ts
systemPrompt: BARNABY_PERSONALITY,
```

### 3. Briefing Service (`src/services/briefing.ts`)

**System prompt**: Remove the inline `buildSystemPrompt()` entirely. Reuse the shared `BARNABY_PERSONALITY` via a new `ResourceLoader` that shares the same system prompt.

**User prompt** (built at runtime) becomes the task instruction:

```
Today is Tuesday, May 5, 2026. It is currently morning.

[core memories if any]

[recent memories if any]

INSTRUCTIONS:
- Use the calendar_list tool to fetch today's events from the primary calendar.
- Generate a daily briefing based on those events and the notes above.
- Start with a brief, warm greeting referencing the time of day.
- Use 2-3 short paragraphs total, max 150 words.
- Use a single bullet list only for 3+ calendar events; otherwise weave them into sentences.
- If no calendar events exist today, do not mention the calendar at all.
- If no memories or tasks exist, do not mention them at all.
- Do not mention core memories unless the user explicitly asks you about them.
- Never apologize for lack of information; just provide what you have.
- If a tool returns an error, mention it briefly in plain English and move on.
- Do not use emojis.
- End with one brief, encouraging closing line.

TONE: Casual, warm, and efficient. Avoid robotic lists. Write like a helpful friend.

[previous briefing context if any]
```

### 4. Reuse Strategy for ResourceLoader

The briefing service currently creates its own `DefaultResourceLoader` because it needs the calendar extension but not YNAB/Telegram tools. We keep that pattern, but instead of duplicating the system prompt inline, import `BARNABY_PERSONALITY`:

```ts
import { BARNABY_PERSONALITY } from '../agent/personality.js';

const resourceLoader = new DefaultResourceLoader({
  ...,
  systemPrompt: BARNABY_PERSONALITY,
});
```

## Files Changed

- `src/agent/personality.ts` — new shared module
- `src/plugins/agent/index.ts` — import and use `BARNABY_PERSONALITY`
- `src/services/briefing.ts` — remove `buildSystemPrompt()`, move instructions to user prompt, add explicit calendar tool instruction

## Testing

- Unit tests for `briefing.ts` should still pass (mocks don't hit the real model).
- End-to-end test with Fastify `inject()` to verify the briefing route still returns a response.

## Out of Scope

- Changing the model from minimax to kimi (user confirmed minimax is sufficient).
- Moving the calendar extension into the shared agent plugin (briefing intentionally isolates its tool set).
- Any changes to memory repository behavior.
