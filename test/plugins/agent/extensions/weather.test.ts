import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { FastifyInstance } from "fastify";
import createWeatherExtension from "../../../../src/plugins/agent/extensions/weather.js";

function createMockExtensionAPI(): ExtensionAPI & {
  _tools: Array<{ name: string; execute: Function }>;
} {
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

function getTools(extApi: ExtensionAPI) {
  return (
    extApi as unknown as { _tools: Array<{ name: string; execute: Function }> }
  )._tools;
}

function createMockFastify(): FastifyInstance {
  return {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    timezone: "America/New_York",
  } as unknown as FastifyInstance;
}

function makeForecastResponse() {
  const today = new Date().toISOString().split("T")[0];
  return {
    latitude: 40.0583,
    longitude: -74.4057,
    timezone: "America/New_York",
    daily: {
      time: [today, "2099-01-01"],
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
      time: [`${today}T14:00`],
      temperature_2m: [72],
      precipitation: [0],
      precipitation_probability: [10],
    },
  };
}

function makeAirQualityResponse() {
  const today = new Date().toISOString().split("T")[0];
  return {
    latitude: 40.0583,
    longitude: -74.4057,
    timezone: "America/New_York",
    hourly: {
      time: [`${today}T12:00`],
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
    expect(fastify.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("500"),
    );
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

    vi.mocked(globalThis.fetch).mockRejectedValueOnce(
      new Error("network failure"),
    );

    const result = await tool.execute("call-1", {});
    expect(result.content[0].text).toContain("network failure");
    expect(fastify.log.error).toHaveBeenCalled();
  });
});
