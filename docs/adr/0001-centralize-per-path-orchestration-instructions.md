# Centralize per-path orchestration instructions in a PromptBuilder module

Per-path prompt instructions for the three agent-driven **delivered-message** paths (Telegram chat, morning briefing, afternoon update) were assembled inline in each caller, duplicating shared behavior rules across `briefing.ts`, `afternoon-update.ts`, and `chat.ts`. Commit `dad39f2` had already centralized *voice/tone* into the personality system; the remaining sprawl was *task/structure* instructions with no single owner.

We introduce `src/agent/prompt-builder.ts` owning **orchestration** text for those three paths under a three-way boundary:

- **PromptBuilder** owns per-path orchestration — greeting, structure, word counts, date ranges, and the 7 shared behavior rules. `chat()` now inherits those 7 rules, which is a deliberate behavior change to Telegram chat (not a no-op refactor).
- **Tool extensions** plus `src/agent/memory-guidelines.ts` continue to own **tool-level** prompt text (`promptGuidelines` / `promptSnippet`), which travels with its tool.
- **The personality system** (`appendSystemPromptOverride` + `personalityRepository`) continues to own **voice/tone**, per `dad39f2`.

A single "all instructions" module would re-create the second source of truth for voice that `dad39f2` removed, and would entangle tool-extension text with cross-path orchestration. The `/remember` command path is excluded from PromptBuilder: its prompt is `MEMORY_CATEGORIZATION_GUIDELINES` (tool-level text already centralized in `memory-guidelines.ts`), and it is not a delivered-message path — it produces a 👍 reaction, not a generated message.

Full spec, context types, and test plan: #11.