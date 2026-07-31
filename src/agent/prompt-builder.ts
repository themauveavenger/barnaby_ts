/**
 * PromptBuilder owns the per-path **orchestration** instruction strings the
 * agent receives on the three delivered-message paths: Telegram chat, the
 * morning briefing, and the afternoon update.
 *
 * Ownership boundary (see ADR-0001):
 * - PromptBuilder → task/structure instructions for delivered messages.
 * - Tool extensions + `memory-guidelines.ts` → tool-level prompt text.
 * - The personality system → voice/tone (no `TONE:` lines live here).
 *
 * The module is stateless and has zero repository dependencies: callers compute
 * date ranges, fetch data, and build a memory-context string, then hand the
 * parts to PromptBuilder to assemble.
 */

// --- Shared behavior rules --------------------------------------------------

/**
 * The 7 behavior rules shared by every delivered-message path. These are
 * composed by all three methods — including `chat()`, which inherits them as
 * a deliberate behavior change. Structural rules (greeting, word counts,
 * bullet formatting) diverge by path and so stay in each method.
 *
 * The "core memories" line uses the canonical briefing wording — the
 * afternoon update previously had a divergently-worded variant that is now
 * reconciled to this single form.
 */
const SHARED_BEHAVIOR_RULES = [
  '- If no calendar events exist, do not mention the calendar at all.',
  '- If no memories or tasks exist, do not mention them at all.',
  '- Do not remind the user about any task listed in the "completed or dismissed" section — those are already handled.',
  '- Do not mention core memories unless the user explicitly asks you about them.',
  '- Never apologize for lack of information; just provide what you have.',
  '- If a tool returns an error, mention it briefly in plain English and move on.',
  '- Do not use emojis.'
] as const;

// --- Calendar context -------------------------------------------------------

/**
 * Enumerates each configured calendar ID. Bounded to actionable guidance only:
 * it does not restate the `calendar_list` tool's own `promptGuidelines` (which
 * already owns "use `primary` as calendarId"). The per-method instructions tell
 * the agent to call `calendar_list` once per ID.
 */
function buildCalendarContext(calendarIds: string[]): string {
  if (calendarIds.length === 0) return '';
  return `Available calendars:\n${calendarIds.map(id => `- ${id}`).join('\n')}`;
}

// --- Previous-briefing preambles -------------------------------------------

interface PreviousBriefingData {
  content: string;
  /** ISO timestamp the previous briefing was triggered. */
  triggeredAt: string;
}

/**
 * Briefing preamble: distinct wording, preserved asymmetry vs the afternoon
 * preamble.
 */
function buildBriefingPreviousContext(previous: PreviousBriefingData): string {
  const date = new Date(previous.triggeredAt).toLocaleDateString('en-US');
  return `\n\nHere is your previous briefing from ${date} for reference. Try not to repeat the same information unless it is still relevant:\n\n${previous.content}`;
}

/**
 * Afternoon preamble: distinct wording, preserved asymmetry vs the briefing
 * preamble.
 */
function buildAfternoonPreviousContext(previous: PreviousBriefingData): string {
  const date = new Date(previous.triggeredAt).toLocaleDateString('en-US');
  return `\n\nHere is the most recent briefing (sent ${date}) for reference. Do not repeat information from it unless something has changed or it requires an update:\n\n${previous.content}`;
}

// --- Context types ---------------------------------------------------------

interface TimeContext {
  today: string;
  timeOfDay: string;
  timezone: string;
  tzAbbr: string;
  tzLong: string;
}

export interface ChatContext {
  userMessage: string;
  memoryContext: string;
  calendarIds: string[];
}

interface BriefingDateRanges {
  yesterdayStart: Date;
  yesterdayEnd: Date;
  todayStart: Date;
  todayEnd: Date;
  weekStart: Date;
  weekEnd: Date;
}

export interface BriefingContext extends TimeContext {
  memoryContext: string;
  calendarIds: string[];
  weatherLatitude?: string;
  weatherLongitude?: string;
  previousBriefing?: PreviousBriefingData;
  dateRanges: BriefingDateRanges;
}

interface AfternoonDateRanges {
  todayStart: Date;
  todayEnd: Date;
  weekStart: Date;
  weekEnd: Date;
}

export interface AfternoonUpdateContext extends TimeContext {
  memoryContext: string;
  calendarIds: string[];
  previousBriefing?: PreviousBriefingData;
  dateRanges: AfternoonDateRanges;
}

// --- Briefing-only instruction constant ------------------------------------

function buildMemoryPriorityContext(today: string): string {
  return `PRIORITY GUIDE FOR USING MEMORIES:
- Calendar events are ground truth for WHAT is happening and WHEN.
- Core memories help you personalize (preferences, facts about the user).
- Recent notes provide context but do NOT override calendar dates.
- If a memory and calendar event describe the same thing, use the calendar for timing and the memory for context only.
- Be precise with dates: "today", "tomorrow", "Monday" must be accurate relative to ${today}.`;
}

// --- Chat-only orchestration text ------------------------------------------

/** Chat-specific orchestration text (tool-use guidance, read-only reminder,
 * honest-reference guidance). The 7 shared rules are composed separately. */
const CHAT_ORCHESTRATION = 'Answer concisely and naturally. '
  + 'Use the memory_list, calendar_list, drive_read_doc, drive_list_docs, wolfram_alpha, kagi_search, and kagi_extract tools to search for relevant information or computations if needed. '
  + 'Your tools only have read-only access to data. You cannot create any new memories, calendar events, or Google documents. '
  + 'If you find relevant memories, calendar events, or text in a Google document, reference them directly by name. '
  + 'If nothing relevant comes up, say so honestly rather than making things up.';

// --- The builder -----------------------------------------------------------

export interface PromptBuilder {
  chat(context: ChatContext): string;
  briefing(context: BriefingContext): string;
  afternoonUpdate(context: AfternoonUpdateContext): string;
}

/**
 * Stateless PromptBuilder. A single shared instance is the whole module; call
 * `promptBuilder.briefing(ctx)` etc. from any caller.
 */
export const promptBuilder: PromptBuilder = {
  chat(context) {
    const calendarContext = buildCalendarContext(context.calendarIds);
    // Chat preserves the conditional-array-spreads + join('\n') blank-line
    // handling (distinct from briefing/afternoon's filter() approach).
    return [
      ...(context.memoryContext ? [context.memoryContext] : []),
      ...(calendarContext ? [calendarContext] : []),
      '',
      `The user asks: "${context.userMessage}"`,
      '',
      CHAT_ORCHESTRATION,
      '',
      ...SHARED_BEHAVIOR_RULES
    ].join('\n');
  },

  briefing(context) {
    const { today, timeOfDay, timezone, tzAbbr, tzLong } = context;
    const memoryPriorityContext = buildMemoryPriorityContext(today);
    const calendarContext = buildCalendarContext(context.calendarIds);
    const weatherContext = context.weatherLatitude && context.weatherLongitude
      ? `Your fixed weather location is latitude ${context.weatherLatitude}, longitude ${context.weatherLongitude} (New Jersey, USA).`
      : '';
    const previousContext = context.previousBriefing
      ? buildBriefingPreviousContext(context.previousBriefing)
      : '';

    const { yesterdayStart, yesterdayEnd, todayStart, todayEnd, weekStart, weekEnd } = context.dateRanges;

    // filter(s => s !== '') drops the empty sections (no memory/calendar/
    // weather/previous) and the intentional spacer entries simultaneously,
    // collapsing sections to single newlines — byte-equivalent to today.
    return [
      `Today is ${today}. It is currently ${timeOfDay}. All times are in ${tzLong} (${timezone}, ${tzAbbr}).`,
      '',
      context.memoryContext,
      memoryPriorityContext,
      '',
      calendarContext,
      '',
      weatherContext,
      '',
      'INSTRUCTIONS:',
      'Use the calendar_list tool to fetch events for each available calendar across these three ranges:',
      `1. Yesterday:     start "${yesterdayStart.toISOString()}" end "${yesterdayEnd.toISOString()}"`,
      `2. Today:         start "${todayStart.toISOString()}"     end "${todayEnd.toISOString()}"`,
      `3. Next 7 days:   start "${weekStart.toISOString()}"      end "${weekEnd.toISOString()}"`,
      '',
      'Call get_weather_forecast and include a 1-2 sentence weather summary after your greeting.',
      'Mention the weather condition, high and low temperatures, approximately when the high will be reached, and whether rain is expected (with timing if available).',
      'Include the US Air Quality Index only if it is moderate or worse.',
      'If the weather tool returns an error, omit the weather section entirely — do not mention it.',
      '',
      'Generate a daily briefing based on those events and the notes above.',
      '- Start with a brief, warm greeting referencing the time of day.',
      '- Mention yesterday only if there were notable events worth following up on.',
      '- Highlight important upcoming events within the next 3 days.',
      '  It is okay to remind about the same event across multiple briefings, but vary how you phrase it.',
      '- If there are any US holidays coming up, you can let the user know about them even though they may not celebrate that particular one.',
      '- **Date precision is critical**: A calendar event for "Mother\'s Day" starting at midnight does NOT mean both today AND tomorrow are Mother\'s Day. Check the actual date range of each event.',
      '- **Avoid duplication**: If you mention a calendar event, do NOT separately mention a memory about the same topic unless it adds genuinely new context.',
      '- Use 2-3 short paragraphs total, max 150 words.',
      '- Use a single bullet list only for 3+ calendar events; otherwise weave them into sentences.',
      ...SHARED_BEHAVIOR_RULES,
      '- End with one brief, encouraging closing line.',
      previousContext
    ].filter(s => s !== '').join('\n');
  },

  afternoonUpdate(context) {
    const { today, timeOfDay, timezone, tzAbbr, tzLong } = context;
    const calendarContext = buildCalendarContext(context.calendarIds);
    const previousContext = context.previousBriefing
      ? buildAfternoonPreviousContext(context.previousBriefing)
      : '';

    const { todayStart, todayEnd, weekStart, weekEnd } = context.dateRanges;

    return [
      `Today is ${today}. It is currently ${timeOfDay}. All times are in ${tzLong} (${timezone}, ${tzAbbr}).`,
      '',
      context.memoryContext,
      '',
      calendarContext,
      '',
      'INSTRUCTIONS:',
      'Use the calendar_list tool to fetch events for each available calendar across these two ranges:',
      `1. Today:       start "${todayStart.toISOString()}"     end "${todayEnd.toISOString()}"`,
      `2. Next 3 days: start "${weekStart.toISOString()}"      end "${weekEnd.toISOString()}"`,
      '',
      'Generate a brief afternoon check-in based on those events and the notes above.',
      '- Start with a brief, warm greeting referencing the time of day.',
      '- Focus on what is ahead this afternoon and evening.',
      '- Highlight anything new or changed since the morning briefing.',
      '- If memories were added today, mention only newly relevant ones.',
      '- Use 1-2 short paragraphs, max 100 words.',
      '- Use a single bullet list only for 3+ calendar events; otherwise weave them into sentences.',
      ...SHARED_BEHAVIOR_RULES,
      '- End with one brief, encouraging closing line.',
      previousContext
    ].filter(s => s !== '').join('\n');
  }
};
