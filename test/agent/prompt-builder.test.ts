import { describe, it, expect } from 'vitest';
import { promptBuilder } from '../../src/agent/prompt-builder.js';

/**
 * Pure-function characterization tests pinning the full expected prompt text
 * per context. Expected strings are hand-derived literals (the source of
 * truth), not computed by the builder — so ordering, blank-line collapsing,
 * and preamble wording are all pinned.
 *
 * Boundary constraints (see #11):
 * - briefing: byte-equivalent to today's prompt.
 * - afternoon: byte-equivalent except the one reconciled "core memories" line.
 * - chat: the new intended output — gains the 7 shared behavior rules.
 */

// Deterministic context values (frozen "morning" of 2026-01-15, US/Eastern).
// These ISO literals are the source of truth the builder must interpolate.
const TODAY = 'Thursday, January 15, 2026';
const TIME_OF_DAY = 'morning';
const TIMEZONE = 'America/New_York';
const TZ_ABBR = 'EST';
const TZ_LONG = 'Eastern Time';

const YESTERDAY_START = '2026-01-14T05:00:00.000Z';
const YESTERDAY_END = '2026-01-15T05:00:00.000Z';
const TODAY_START = '2026-01-15T05:00:00.000Z';
const TODAY_END = '2026-01-16T05:00:00.000Z';
const WEEK_START = '2026-01-16T05:00:00.000Z';
const WEEK_END = '2026-01-23T05:00:00.000Z';

const SHARE_RULES = [
  '- If no calendar events exist, do not mention the calendar at all.',
  '- If no memories or tasks exist, do not mention them at all.',
  '- Do not remind the user about any task listed in the "completed or dismissed" section — those are already handled.',
  '- Do not mention core memories unless the user explicitly asks you about them.',
  '- Never apologize for lack of information; just provide what you have.',
  '- If a tool returns an error, mention it briefly in plain English and move on.',
  '- Do not use emojis.'
];

describe('PromptBuilder.briefing', () => {
  it('matches the expected prompt with calendars and weather but no memory/previous', () => {
    const prompt = promptBuilder.briefing({
      today: TODAY,
      timeOfDay: TIME_OF_DAY,
      timezone: TIMEZONE,
      tzAbbr: TZ_ABBR,
      tzLong: TZ_LONG,
      memoryContext: '',
      calendarIds: ['test@example.com', 'family@group.calendar.google.com'],
      weatherLatitude: '40.7',
      weatherLongitude: '-74.0',
      dateRanges: {
        yesterdayStart: new Date(YESTERDAY_START),
        yesterdayEnd: new Date(YESTERDAY_END),
        todayStart: new Date(TODAY_START),
        todayEnd: new Date(TODAY_END),
        weekStart: new Date(WEEK_START),
        weekEnd: new Date(WEEK_END)
      }
    });

    const expected = [
      `Today is ${TODAY}. It is currently ${TIME_OF_DAY}. All times are in ${TZ_LONG} (${TIMEZONE}, ${TZ_ABBR}).`,
      'PRIORITY GUIDE FOR USING MEMORIES:',
      '- Calendar events are ground truth for WHAT is happening and WHEN.',
      '- Core memories help you personalize (preferences, facts about the user).',
      '- Recent notes provide context but do NOT override calendar dates.',
      '- If a memory and calendar event describe the same thing, use the calendar for timing and the memory for context only.',
      `- Be precise with dates: "today", "tomorrow", "Monday" must be accurate relative to ${TODAY}.`,
      'Available calendars:',
      '- test@example.com',
      '- family@group.calendar.google.com',
      'Your fixed weather location is latitude 40.7, longitude -74.0 (New Jersey, USA).',
      'INSTRUCTIONS:',
      'Use the calendar_list tool to fetch events for each available calendar across these three ranges:',
      `1. Yesterday:     start "${YESTERDAY_START}" end "${YESTERDAY_END}"`,
      `2. Today:         start "${TODAY_START}"     end "${TODAY_END}"`,
      `3. Next 7 days:   start "${WEEK_START}"      end "${WEEK_END}"`,
      'Call get_weather_forecast and include a 1-2 sentence weather summary after your greeting.',
      'Mention the weather condition, high and low temperatures, approximately when the high will be reached, and whether rain is expected (with timing if available).',
      'Include the US Air Quality Index only if it is moderate or worse.',
      'If the weather tool returns an error, omit the weather section entirely — do not mention it.',
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
      ...SHARE_RULES,
      '- End with one brief, encouraging closing line.'
    ].join('\n');

    expect(prompt).toBe(expected);
  });

  it('omits weather and calendar sections when absent and appends previous briefing with its preamble', () => {
    // triggeredAt 2026-01-14 → toLocaleDateString('en-US') = '1/14/2026'
    const previousBriefing = {
      content: 'Morning briefing content',
      triggeredAt: '2026-01-14T11:00:00.000Z'
    };

    const prompt = promptBuilder.briefing({
      today: TODAY,
      timeOfDay: TIME_OF_DAY,
      timezone: TIMEZONE,
      tzAbbr: TZ_ABBR,
      tzLong: TZ_LONG,
      memoryContext: 'Core memories about the user:\n- I am vegetarian',
      calendarIds: [],
      dateRanges: {
        yesterdayStart: new Date(YESTERDAY_START),
        yesterdayEnd: new Date(YESTERDAY_END),
        todayStart: new Date(TODAY_START),
        todayEnd: new Date(TODAY_END),
        weekStart: new Date(WEEK_START),
        weekEnd: new Date(WEEK_END)
      },
      previousBriefing
    });

    const expected = [
      `Today is ${TODAY}. It is currently ${TIME_OF_DAY}. All times are in ${TZ_LONG} (${TIMEZONE}, ${TZ_ABBR}).`,
      'Core memories about the user:\n- I am vegetarian',
      'PRIORITY GUIDE FOR USING MEMORIES:',
      '- Calendar events are ground truth for WHAT is happening and WHEN.',
      '- Core memories help you personalize (preferences, facts about the user).',
      '- Recent notes provide context but do NOT override calendar dates.',
      '- If a memory and calendar event describe the same thing, use the calendar for timing and the memory for context only.',
      `- Be precise with dates: "today", "tomorrow", "Monday" must be accurate relative to ${TODAY}.`,
      'INSTRUCTIONS:',
      'Use the calendar_list tool to fetch events for each available calendar across these three ranges:',
      `1. Yesterday:     start "${YESTERDAY_START}" end "${YESTERDAY_END}"`,
      `2. Today:         start "${TODAY_START}"     end "${TODAY_END}"`,
      `3. Next 7 days:   start "${WEEK_START}"      end "${WEEK_END}"`,
      'Call get_weather_forecast and include a 1-2 sentence weather summary after your greeting.',
      'Mention the weather condition, high and low temperatures, approximately when the high will be reached, and whether rain is expected (with timing if available).',
      'Include the US Air Quality Index only if it is moderate or worse.',
      'If the weather tool returns an error, omit the weather section entirely — do not mention it.',
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
      ...SHARE_RULES,
      '- End with one brief, encouraging closing line.',
      // The preamble begins with "\n\n"; joined after the closing line with
      // "\n" → three newlines (two blank lines), byte-equivalent to today.
      '\n\nHere is your previous briefing from 1/14/2026 for reference. Try not to repeat the same information unless it is still relevant:\n\nMorning briefing content'
    ].join('\n');

    expect(prompt).toBe(expected);
  });

  it('composes the 7 shared behavior rules (sanity, byte-equivalent wording)', () => {
    const prompt = promptBuilder.briefing({
      today: TODAY,
      timeOfDay: TIME_OF_DAY,
      timezone: TIMEZONE,
      tzAbbr: TZ_ABBR,
      tzLong: TZ_LONG,
      memoryContext: '',
      calendarIds: [],
      dateRanges: {
        yesterdayStart: new Date(YESTERDAY_START),
        yesterdayEnd: new Date(YESTERDAY_END),
        todayStart: new Date(TODAY_START),
        todayEnd: new Date(TODAY_END),
        weekStart: new Date(WEEK_START),
        weekEnd: new Date(WEEK_END)
      }
    });

    for (const rule of SHARE_RULES) {
      expect(prompt).toContain(rule);
    }
  });
});
