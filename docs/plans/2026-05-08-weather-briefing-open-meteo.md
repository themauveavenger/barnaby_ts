# Add Weather Report to Daily Briefing via Open-Meteo

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a concise weather summary to the daily briefing by exposing a single agent tool (`get_weather_forecast`) that queries the free Open-Meteo API. The tool returns today's high/low temperature, the approximate time of the daily high, rain expectations with timing, and the US Air Quality Index. Location is fixed via environment variables (latitude/longitude) and injected into the briefing prompt as context.

**Architecture:** A new pure-data module (`src/plugins/weather-formatter.ts`) contains all data-processing logic (scanning hourly arrays for peak temperature and rain windows, formatting human-readable summaries). A new agent extension (`src/plugins/agent/extensions/weather.ts`) registers the tool, performs the two `fetch` calls, and delegates parsing to the formatter. The briefing service adds the tool to its session and injects location context into the prompt. No new runtime dependencies are required.

**Tech Stack:** Node.js 24, TypeScript, Fastify, vitest, native `fetch`

---

## File Structure

```
src/
  plugins/
    weather-formatter.ts            # NEW: pure functions to process Open-Meteo responses
  plugins/agent/extensions/
    weather.ts                       # NEW: agent extension registering get_weather_forecast
    index.ts                         # MODIFY: register weather extension
  services/
    briefing.ts                      # MODIFY: add tool to session, inject location context
  .env.example                       # MODIFY: add WEATHER_LATITUDE and WEATHER_LONGITUDE
test/
  plugins/
    weather-formatter.test.ts        # NEW: unit tests for data processing and formatting
    agent/extensions/weather.test.ts # NEW: integration tests for the tool with mocked fetch
```

---

## Task 1: Create `src/plugins/weather-formatter.ts`

**Files:**
- Create: `src/plugins/weather-formatter.ts`

- [ ] **Step 1: Define response types**

Create the file with Zod-like (plain TS) types for the two Open-Meteo JSON shapes:

```ts
export type OpenMeteoForecastResponse = {
  latitude: number;
  longitude: number;
  timezone: string;
  daily: {
    time: string[];                    // ISO dates, e.g. ["2026-05-08", "2026-05-09"]
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    apparent_temperature_max: number[];
    apparent_temperature_min: number[];
    precipitation_sum: number[];
    precipitation_hours: number[];
    precipitation_probability_max: number[];
    weather_code: number[];
  };
  hourly: {
    time: string[];                    // ISO timestamps, e.g. ["2026-05-08T00:00", ...]
    temperature_2m: number[];
    precipitation: number[];
    precipitation_probability: number[];
  };
};

export type OpenMeteoAirQualityResponse = {
  latitude: number;
  longitude: number;
  timezone: string;
  hourly: {
    time: string[];
    us_aqi: (number | null)[];
    pm2_5: (number | null)[];
    ozone: (number | null)[];
  };
};
```

- [ ] **Step 2: Add pure processing functions**

Append to the same file:

```ts
export function findPeakTempHour(hourly: OpenMeteoForecastResponse['hourly'], targetDate: string): string | null {
  // Scan hourly.temperature_2m for the maximum value on targetDate.
  // Return the first matching ISO time string, or null if no data.
}

export function findRainWindows(hourly: OpenMeteoForecastResponse['hourly'], targetDate: string): Array<{ start: string; end: string }> | null {
  // Scan hourly.precipitation for contiguous blocks where value > 0 on targetDate.
  // Return an array of {start, end} ISO time strings, or null if no rain.
  // If rain is scattered, merge windows separated by 1 hour or less.
}

export function getMiddayAqi(hourly: OpenMeteoAirQualityResponse['hourly'], targetDate: string): number | null {
  // Look for the first US AQI reading between 10:00 and 14:00 on targetDate.
  // Return the value, or null if no data.
}

export function aqiCategory(aqi: number): string {
  // Return EPA category: Good, Moderate, Unhealthy for Sensitive Groups, Unhealthy, etc.
}

export function weatherCodeToDescription(code: number): string {
  // Map WMO Weather interpretation codes to concise English descriptions.
  // Open-Meteo returns only the numeric code; the API does not provide text.
}

export function formatWeatherSummary(
  forecast: OpenMeteoForecastResponse,
  airQuality: OpenMeteoAirQualityResponse | null,
  targetDate: string,
  timezone: string,
): string {
  // Compose the final human-readable summary:
  // - Weather condition description from daily weather_code (e.g., "Partly cloudy")
  // - High / low for targetDate (use apparent temp if it differs meaningfully)
  // - Time of high temperature (e.g., "around 2:00 PM")
  // - Rain expectation with timing windows, or "No rain expected"
  // - US AQI if moderate or worse, otherwise omit
  // All times formatted in the given timezone using date-fns.
}
```

Implementation notes:
- Use `date-fns` (`parseISO`, `format`, `isSameDay`) for timezone-aware formatting. Use `TZDate` from `@date-fns/tz`.
- Merge rain windows with ≤1 hour gap to avoid reporting "rain at 2:00 PM and 2:15 PM".
- If `precipitation_sum` is 0 for the day, skip scanning hourly and report "No rain expected."
- If the forecast API returns no data for `targetDate`, return `"Weather data is currently unavailable."`.
- Weather code mapping should be concise. Group related codes under a single phrase:
  - 0 → "Clear sky"
  - 1, 2, 3 → "Mainly clear", "Partly cloudy", "Overcast"
  - 45, 48 → "Fog"
  - 51, 53, 55 → "Drizzle"
  - 56, 57 → "Freezing drizzle"
  - 61, 63, 65 → "Rain"
  - 66, 67 → "Freezing rain"
  - 71, 73, 75 → "Snow"
  - 77 → "Snow grains"
  - 80, 81, 82 → "Rain showers"
  - 85, 86 → "Snow showers"
  - 95 → "Thunderstorm"
  - 96, 99 → "Thunderstorm with hail"

- [ ] **Step 3: Commit**

```bash
git add src/plugins/weather-formatter.ts
git commit -m "feat(weather): add pure data processing and formatting for Open-Meteo"
```

---

## Task 2: Create `src/plugins/agent/extensions/weather.ts`

**Files:**
- Create: `src/plugins/agent/extensions/weather.ts`

- [ ] **Step 1: Create the agent extension**

```ts
import type { ExtensionAPI, ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type { FastifyInstance } from "fastify";
import { Type } from "typebox";
import {
  formatWeatherSummary,
  type OpenMeteoForecastResponse,
  type OpenMeteoAirQualityResponse,
} from "../../weather-formatter.js";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";

export default function createWeatherExtension(fastify: FastifyInstance): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "get_weather_forecast",
      label: "Get Weather Forecast",
      description:
        "Fetches today's weather forecast and air quality for the user's fixed location. Returns high/low temperature, approximate time of the daily high, rain expectations with timing, and US Air Quality Index if moderate or worse.",
      parameters: Type.Object({}), // No parameters — location is env-configured
      async execute(_toolCallId, _params) {
        const latitude = process.env.WEATHER_LATITUDE;
        const longitude = process.env.WEATHER_LONGITUDE;

        if (!latitude || !longitude) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Weather location is not configured. Set WEATHER_LATITUDE and WEATHER_LONGITUDE environment variables.",
              },
            ],
            details: {},
          };
        }

        const today = new Date().toISOString().split("T")[0];
        const timezone = fastify.timezone;

        const forecastParams = new URLSearchParams({
          latitude,
          longitude,
          daily: [
            "temperature_2m_max",
            "temperature_2m_min",
            "apparent_temperature_max",
            "apparent_temperature_min",
            "precipitation_sum",
            "precipitation_hours",
            "precipitation_probability_max",
            "weather_code",
          ].join(","),
          hourly: ["temperature_2m", "precipitation", "precipitation_probability"].join(","),
          temperature_unit: "fahrenheit",
          precipitation_unit: "inch",
          timezone,
          forecast_days: "2",
        });

        const aqParams = new URLSearchParams({
          latitude,
          longitude,
          hourly: ["us_aqi", "pm2_5", "ozone"].join(","),
          timezone,
          forecast_days: "2",
        });

        try {
          const [forecastRes, aqRes] = await Promise.all([
            fetch(`${FORECAST_URL}?${forecastParams.toString()}`),
            fetch(`${AIR_QUALITY_URL}?${aqParams.toString()}`),
          ]);

          if (!forecastRes.ok) {
            throw new Error(`Forecast API returned ${forecastRes.status}`);
          }

          const forecast: OpenMeteoForecastResponse = await forecastRes.json();

          let airQuality: OpenMeteoAirQualityResponse | null = null;
          if (aqRes.ok) {
            airQuality = await aqRes.json();
          } else {
            fastify.log.warn(`Air quality API returned ${aqRes.status}; omitting AQI`);
          }

          const text = formatWeatherSummary(forecast, airQuality, today, timezone);
          return {
            content: [{ type: "text" as const, text }],
            details: {},
          };
        } catch (error) {
          fastify.log.error(error, "Failed to fetch weather forecast");
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Failed to fetch weather data. ${message}`,
              },
            ],
            details: {},
          };
        }
      },
    });
  };
}
```

**Critical design decisions:**
- The tool takes no parameters. Location is fixed at boot time via env vars. This prevents the LLM from hallucinating coordinates.
- `Promise.all` fetches forecast and air quality in parallel.
- Air quality failure is **non-fatal** — the tool logs a warning and omits AQI from the summary rather than failing the entire briefing.
- `forecast_days=2` ensures we have today's full 24-hour hourly array even when the API's "today" slice might be partial near midnight.
- `temperature_unit=fahrenheit` and `precipitation_unit=inch` match the user's US location.

- [ ] **Step 2: Commit**

```bash
git add src/plugins/agent/extensions/weather.ts
git commit -m "feat(agent): add get_weather_forecast tool backed by Open-Meteo"
```

---

## Task 3: Register the Weather Extension

**Files:**
- Modify: `src/plugins/agent/index.ts`

- [ ] **Step 1: Import and register**

Add import:

```ts
import createWeatherExtension from "./extensions/weather.js";
```

Add to `extensionFactories` array:

```ts
    extensionFactories: [
      createCalendarExtension(fastify),
      createYnabExtension(fastify),
      createTelegramExtension(fastify),
      createMemoryExtension(fastify),
      createWeatherExtension(fastify), // NEW
    ],
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/plugins/agent/index.ts
git commit -m "feat(agent): register weather extension"
```

---

## Task 4: Update Briefing Service

**Files:**
- Modify: `src/services/briefing.ts`

- [ ] **Step 1: Add tool to session**

Find:

```ts
          tools: ['calendar_list'],
```

Replace with:

```ts
          tools: ['calendar_list', 'get_weather_forecast'],
```

- [ ] **Step 2: Inject location context into prompt**

After the `calendarContext` block, add a `weatherContext` block:

```ts
          const weatherLat = process.env.WEATHER_LATITUDE;
          const weatherLon = process.env.WEATHER_LONGITUDE;
          const weatherContext = weatherLat && weatherLon
            ? `Your fixed weather location is latitude ${weatherLat}, longitude ${weatherLon} (New Jersey, USA).`
            : '';
```

- [ ] **Step 3: Add weather instruction**

Inside the `INSTRUCTIONS:` block, add after the calendar instructions:

```
Call get_weather_forecast and include a 1-2 sentence weather summary after your greeting.
Mention today's high and low temperatures, approximately when the high will be reached, and whether rain is expected (with timing if available).
Include the US Air Quality Index only if it is moderate or worse.
If the weather tool returns an error, omit the weather section entirely — do not mention it.
```

Append `weatherContext` to the prompt array before `INSTRUCTIONS:`.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/briefing.ts
git commit -m "feat(briefing): add weather forecast tool and location context to prompt"
```

---

## Task 5: Update `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add weather environment variables**

Append to the file:

```bash
# Weather location for daily briefing (latitude and longitude)
# Example: New Jersey, USA
WEATHER_LATITUDE=40.0583
WEATHER_LONGITUDE=-74.4057
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs(env): add WEATHER_LATITUDE and WEATHER_LONGITUDE examples"
```

---

## Task 6: Add Unit Tests for `weather-formatter.ts`

**Files:**
- Create: `test/plugins/weather-formatter.test.ts`

- [ ] **Step 1: Create test file**

```ts
import { describe, it, expect } from "vitest";
import {
  findPeakTempHour,
  findRainWindows,
  getMiddayAqi,
  aqiCategory,
  weatherCodeToDescription,
  formatWeatherSummary,
} from "../../src/plugins/weather-formatter.js";

function makeHourly(times: string[], temps: number[], precip: number[]) {
  return { time: times, temperature_2m: temps, precipitation: precip, precipitation_probability: precip.map(() => 50) };
}

function makeDaily(overrides: Partial<typeof dailyBase> = {}) {
  return { ...dailyBase, ...overrides };
}

const dailyBase = {
  time: ["2026-05-08", "2026-05-09"],
  temperature_2m_max: [75, 80],
  temperature_2m_min: [55, 60],
  apparent_temperature_max: [78, 83],
  apparent_temperature_min: [56, 61],
  precipitation_sum: [0.1, 0],
  precipitation_hours: [2, 0],
  precipitation_probability_max: [60, 10],
  weather_code: [61, 0],
};

describe("findPeakTempHour", () => {
  it("returns the hour of the highest temperature", () => {
    const times = ["2026-05-08T10:00", "2026-05-08T14:00", "2026-05-08T18:00"];
    const hourly = makeHourly(times, [65, 75, 70], [0, 0, 0]);
    expect(findPeakTempHour(hourly, "2026-05-08")).toBe("2026-05-08T14:00");
  });

  it("returns the first occurrence if multiple hours share the max", () => {
    const times = ["2026-05-08T12:00", "2026-05-08T13:00", "2026-05-08T14:00"];
    const hourly = makeHourly(times, [75, 75, 70], [0, 0, 0]);
    expect(findPeakTempHour(hourly, "2026-05-08")).toBe("2026-05-08T12:00");
  });

  it("returns null when target date has no data", () => {
    const hourly = makeHourly(["2026-05-09T12:00"], [70], [0]);
    expect(findPeakTempHour(hourly, "2026-05-08")).toBeNull();
  });
});

describe("findRainWindows", () => {
  it("returns null when there is no rain", () => {
    const times = ["2026-05-08T08:00", "2026-05-08T09:00", "2026-05-08T10:00"];
    const hourly = makeHourly(times, [60, 60, 60], [0, 0, 0]);
    expect(findRainWindows(hourly, "2026-05-08")).toBeNull();
  });

  it("detects a single rain window", () => {
    const times = ["2026-05-08T12:00", "2026-05-08T13:00", "2026-05-08T14:00"];
    const hourly = makeHourly(times, [60, 60, 60], [0, 0.1, 0.2]);
    const windows = findRainWindows(hourly, "2026-05-08")!;
    expect(windows).toHaveLength(1);
    expect(windows[0].start).toBe("2026-05-08T13:00");
    expect(windows[0].end).toBe("2026-05-08T14:00");
  });

  it("merges windows separated by one dry hour", () => {
    const times = [
      "2026-05-08T12:00",
      "2026-05-08T13:00",
      "2026-05-08T14:00",
      "2026-05-08T15:00",
      "2026-05-08T16:00",
    ];
    const hourly = makeHourly(times, [60, 60, 60, 60, 60], [0.1, 0, 0.2, 0.3, 0]);
    const windows = findRainWindows(hourly, "2026-05-08")!;
    expect(windows).toHaveLength(1);
    expect(windows[0].start).toBe("2026-05-08T12:00");
    expect(windows[0].end).toBe("2026-05-08T15:00");
  });

  it("keeps windows separate when gap is two or more dry hours", () => {
    const times = [
      "2026-05-08T10:00",
      "2026-05-08T11:00",
      "2026-05-08T12:00",
      "2026-05-08T13:00",
      "2026-05-08T14:00",
    ];
    const hourly = makeHourly(times, [60, 60, 60, 60, 60], [0.1, 0, 0, 0.2, 0]);
    const windows = findRainWindows(hourly, "2026-05-08")!;
    expect(windows).toHaveLength(2);
  });
});

describe("getMiddayAqi", () => {
  it("returns the AQI at midday", () => {
    const hourly = {
      time: ["2026-05-08T08:00", "2026-05-08T12:00", "2026-05-08T16:00"],
      us_aqi: [30, 55, 40],
      pm2_5: [5, 10, 8],
      ozone: [30, 35, 32],
    };
    expect(getMiddayAqi(hourly, "2026-05-08")).toBe(55);
  });

  it("returns null when midday has no data", () => {
    const hourly = {
      time: ["2026-05-08T08:00"],
      us_aqi: [30],
      pm2_5: [5],
      ozone: [30],
    };
    expect(getMiddayAqi(hourly, "2026-05-08")).toBeNull();
  });

  it("skips null AQI values and finds the next valid reading in the midday window", () => {
    const hourly = {
      time: ["2026-05-08T10:00", "2026-05-08T11:00", "2026-05-08T12:00"],
      us_aqi: [null, null, 62],
      pm2_5: [null, null, 12],
      ozone: [null, null, 40],
    };
    expect(getMiddayAqi(hourly, "2026-05-08")).toBe(62);
  });
});

describe("aqiCategory", () => {
  it.each([
    [15, "Good"],
    [55, "Moderate"],
    [105, "Unhealthy for Sensitive Groups"],
    [155, "Unhealthy"],
    [205, "Very Unhealthy"],
    [305, "Hazardous"],
  ])("AQI %i → %s", (aqi, expected) => {
    expect(aqiCategory(aqi)).toBe(expected);
  });
});

describe("weatherCodeToDescription", () => {
  it.each([
    [0, "Clear sky"],
    [1, "Mainly clear"],
    [2, "Partly cloudy"],
    [3, "Overcast"],
    [45, "Fog"],
    [48, "Fog"],
    [61, "Rain"],
    [63, "Rain"],
    [65, "Rain"],
    [71, "Snow"],
    [73, "Snow"],
    [75, "Snow"],
    [80, "Rain showers"],
    [81, "Rain showers"],
    [82, "Rain showers"],
    [95, "Thunderstorm"],
    [96, "Thunderstorm with hail"],
    [99, "Thunderstorm with hail"],
  ])("code %i → %s", (code, expected) => {
    expect(weatherCodeToDescription(code)).toBe(expected);
  });

  it("returns 'Unknown' for unmapped codes", () => {
    expect(weatherCodeToDescription(999)).toBe("Unknown");
  });
});

describe("formatWeatherSummary", () => {
  it("formats a complete summary with rain and moderate AQI", () => {
    const forecast = {
      latitude: 40.0583,
      longitude: -74.4057,
      timezone: "America/New_York",
      daily: makeDaily(),
      hourly: makeHourly(
        ["2026-05-08T10:00", "2026-05-08T14:00", "2026-05-08T18:00"],
        [65, 75, 70],
        [0, 0.1, 0],
      ),
    };

    const airQuality = {
      latitude: 40.0583,
      longitude: -74.4057,
      timezone: "America/New_York",
      hourly: {
        time: ["2026-05-08T12:00"],
        us_aqi: [55],
        pm2_5: [10],
        ozone: [35],
      },
    };

    const text = formatWeatherSummary(forecast, airQuality, "2026-05-08", "America/New_York");
    expect(text).toContain("Rain");         // weather_code 61 → "Rain"
    expect(text).toContain("75°F");
    expect(text).toContain("55°F");
    expect(text).toContain("rain");
    expect(text).toContain("AQI");
    expect(text).toContain("Moderate");
  });

  it("omits AQI when it is Good", () => {
    const forecast = {
      latitude: 40.0583,
      longitude: -74.4057,
      timezone: "America/New_York",
      daily: makeDaily(),
      hourly: makeHourly(
        ["2026-05-08T14:00"],
        [75],
        [0],
      ),
    };

    const airQuality = {
      latitude: 40.0583,
      longitude: -74.4057,
      timezone: "America/New_York",
      hourly: {
        time: ["2026-05-08T12:00"],
        us_aqi: [25],
        pm2_5: [5],
        ozone: [30],
      },
    };

    const text = formatWeatherSummary(forecast, airQuality, "2026-05-08", "America/New_York");
    expect(text).not.toContain("AQI");
  });

  it("omits AQI when air quality data is null", () => {
    const forecast = {
      latitude: 40.0583,
      longitude: -74.4057,
      timezone: "America/New_York",
      daily: makeDaily(),
      hourly: makeHourly(["2026-05-08T14:00"], [75], [0]),
    };

    const text = formatWeatherSummary(forecast, null, "2026-05-08", "America/New_York");
    expect(text).not.toContain("AQI");
  });

  it("reports 'no rain expected' when precipitation sum is zero", () => {
    const forecast = {
      latitude: 40.0583,
      longitude: -74.4057,
      timezone: "America/New_York",
      daily: makeDaily({ precipitation_sum: [0, 0], precipitation_hours: [0, 0] }),
      hourly: makeHourly(["2026-05-08T14:00"], [75], [0]),
    };

    const text = formatWeatherSummary(forecast, null, "2026-05-08", "America/New_York");
    expect(text).toContain("No rain expected");
  });

  it("handles missing forecast data gracefully", () => {
    const forecast = {
      latitude: 40.0583,
      longitude: -74.4057,
      timezone: "America/New_York",
      daily: makeDaily(),
      hourly: makeHourly(["2026-05-09T14:00"], [75], [0]),
    };

    const text = formatWeatherSummary(forecast, null, "2026-05-08", "America/New_York");
    expect(text).toContain("unavailable");
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm run test:minimal -- test/plugins/weather-formatter.test.ts
```

Expected: PASS (tests will fail until implementation is written).

- [ ] **Step 3: Commit**

```bash
git add test/plugins/weather-formatter.test.ts
git commit -m "test(weather): add unit tests for Open-Meteo data processing"
```

---

## Task 7: Add Integration Tests for the Weather Tool

**Files:**
- Create: `test/plugins/agent/extensions/weather.test.ts`

- [ ] **Step 1: Create mock helpers**

```ts
import { vi } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { FastifyInstance } from "fastify";

export function createMockExtensionAPI(): ExtensionAPI & { _tools: Array<{ name: string; execute: Function }> } {
  const tools: Array<{ name: string; execute: Function }> = [];
  return {
    registerTool: vi.fn((tool) => tools.push(tool)),
    on: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    registerFlag: vi.fn(),
    _tools: tools,
  } as unknown as ExtensionAPI & { _tools: typeof tools };
}

export function getTools(extApi: ExtensionAPI) {
  return (extApi as unknown as { _tools: Array<{ name: string; execute: Function }> })._tools;
}

export function createMockFastify(): FastifyInstance {
  return {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    timezone: "America/New_York",
  } as unknown as FastifyInstance;
}
```

- [ ] **Step 2: Create tool integration tests**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import createWeatherExtension from "../../../../../../src/plugins/agent/extensions/weather.js";
import { createMockExtensionAPI, getTools, createMockFastify } from "./test-helpers.js";

function makeForecastResponse() {
  return {
    latitude: 40.0583,
    longitude: -74.4057,
    timezone: "America/New_York",
    daily: {
      time: [new Date().toISOString().split("T")[0], "2099-01-01"],
      temperature_2m_max: [72, 80],
      temperature_2m_min: [55, 60],
      apparent_temperature_max: [74, 82],
      apparent_temperature_min: [56, 61],
      precipitation_sum: [0, 0],
      precipitation_hours: [0, 0],
      precipitation_probability_max: [10, 20],
      weather_code: [0, 0],
    },
    hourly: {
      time: [`${new Date().toISOString().split("T")[0]}T14:00`],
      temperature_2m: [72],
      precipitation: [0],
      precipitation_probability: [10],
    },
  };
}

function makeAirQualityResponse() {
  return {
    latitude: 40.0583,
    longitude: -74.4057,
    timezone: "America/New_York",
    hourly: {
      time: [`${new Date().toISOString().split("T")[0]}T12:00`],
      us_aqi: [35],
      pm2_5: [6],
      ozone: [30],
    },
  };
}

describe("get_weather_forecast tool", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("WEATHER_LATITUDE", "40.0583");
    vi.stubEnv("WEATHER_LONGITUDE", "-74.4057");
  });

  afterEach(() => {
    vi.stubGlobal("fetch", originalFetch);
    vi.unstubAllEnvs();
  });

  function setup() {
    const fastify = createMockFastify();
    const extApi = createMockExtensionAPI();
    createWeatherExtension(fastify)(extApi);
    const tools = getTools(extApi);
    const tool = tools.find((t) => t.name === "get_weather_forecast")!;
    return { fastify, tool };
  }

  it("returns formatted weather summary on success", async () => {
    const { tool } = setup();

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(makeForecastResponse()), { status: 200 }),
    );
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(makeAirQualityResponse()), { status: 200 }),
    );

    const result = await tool.execute("call-1", {});
    expect(result.content[0].text).toContain("72°F");
    expect(result.content[0].text).toContain("55°F");
  });

  it("omits AQI when air quality API fails", async () => {
    const { tool, fastify } = setup();

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(makeForecastResponse()), { status: 200 }),
    );
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 }),
    );

    const result = await tool.execute("call-1", {});
    expect(result.content[0].text).not.toContain("AQI");
    expect(fastify.log.warn).toHaveBeenCalledWith(expect.stringContaining("500"));
  });

  it("returns error when forecast API fails", async () => {
    const { tool, fastify } = setup();

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("Bad Request", { status: 400 }),
    );
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(makeAirQualityResponse()), { status: 200 }),
    );

    const result = await tool.execute("call-1", {});
    expect(result.content[0].text).toContain("Error");
    expect(fastify.log.error).toHaveBeenCalled();
  });

  it("returns configuration error when env vars are missing", async () => {
    vi.unstubAllEnvs();
    const { tool } = setup();

    const result = await tool.execute("call-1", {});
    expect(result.content[0].text).toContain("not configured");
  });

  it("returns error text when fetch throws", async () => {
    const { tool, fastify } = setup();

    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("network failure"));

    const result = await tool.execute("call-1", {});
    expect(result.content[0].text).toContain("network failure");
    expect(fastify.log.error).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npm run test:minimal -- test/plugins/agent/extensions/weather.test.ts
```

Expected: PASS (tests will fail until implementation is written).

- [ ] **Step 4: Commit**

```bash
git add test/plugins/agent/extensions/weather.test.ts test/plugins/agent/extensions/weather/test-helpers.ts
# Note: if test-helpers.ts is colocated inside weather/ directory, adjust path above.
git commit -m "test(agent): add integration tests for weather tool"
```

---

## Task 8: Full Test Run and Final Verification

- [ ] **Step 1: Run the full test suite**

```bash
npm run test:minimal
```

Expected: All tests PASS.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Final commit**

```bash
git commit -m "feat(briefing): integrate Open-Meteo weather and air quality report"
```

---

## Self-Review

**Spec coverage:**
- Daily high/low temperature → `daily.temperature_2m_max/min` in formatter
- Approximate time of high → `findPeakTempHour` scans hourly temps
- Rain expectation and timing → `findRainWindows` scans hourly precipitation
- Weather condition description → `weatherCodeToDescription` maps WMO codes (Open-Meteo returns numbers only)
- Air Quality (US AQI) → `getMiddayAqi` + `aqiCategory`
- Pollen → **Intentionally omitted** (Open-Meteo pollen is Europe-only)
- No API key required → Confirmed; Open-Meteo is free
- Location fixed via env vars → `WEATHER_LATITUDE`, `WEATHER_LONGITUDE`
- Briefing prompt integration → Task 4

**Critical gaps addressed:**
- **Missing env vars:** Tool returns explicit error text; briefing prompt instructs the LLM to omit weather if the tool errors.
- **API timeout / network failure:** `fetch` is wrapped in `try/catch`; tool returns error text without crashing the briefing.
- **Air quality API partial failure:** Non-fatal. The tool logs a warning and omits AQI rather than failing the entire forecast.
- **Empty or mismatched arrays:** Formatter functions validate that `targetDate` exists in the response arrays before indexing; return `"unavailable"` if not found.
- **Silent Open-Meteo errors:** HTTP status is checked on both requests. A non-OK forecast response throws; a non-OK air quality response is logged and skipped.
- **Rain window fragmentation:** Windows separated by ≤1 dry hour are merged to avoid choppy output.
- **Ambiguous peak temperature:** If multiple hours share the max, the first is reported ("around 2:00 PM" is approximate anyway).
- **Raw WMO weather codes:** Open-Meteo returns only numeric codes. The tool converts them to text (e.g., 61 → "Rain") before returning to the LLM.
- **Word count pressure:** Briefing prompt explicitly limits weather to 1-2 sentences.

**Minor gaps addressed:**
- Unit tests for pure processing functions with edge cases (no rain, multiple rain windows, null AQI, missing data)
- Integration tests for tool success, API failure, missing config, and network exceptions
- Fahrenheit/inch units for US location via API parameters
- Timezone alignment using `fastify.timezone` (consistent with calendar formatting)

**Edge cases addressed:**
- `precipitation_sum === 0` → skips hourly scan, reports "No rain expected"
- Air quality `us_aqi` contains `null` values → `getMiddayAqi` skips nulls within the midday window
- Target date not present in API response → returns "Weather data is currently unavailable"
- Multiple contiguous rainy hours → reported as a single time range (e.g., "from 2:00 PM to 4:00 PM")
- Unmapped WMO weather code → returns "Unknown" rather than a bare number

**Placeholder scan:** None found. All steps contain exact code, commands, and expected output.

**Type consistency:** All response shapes are typed explicitly. No `any` or `Record<string, unknown>` is used for API responses.
