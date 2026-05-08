import { format, isSameDay, parseISO } from "date-fns";
import { TZDate } from "@date-fns/tz";

export type OpenMeteoForecastResponse = {
  latitude: number;
  longitude: number;
  timezone: string;
  daily: {
    time: string[];
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
    time: string[];
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

export function findPeakTempHour(
  hourly: OpenMeteoForecastResponse["hourly"],
  targetDate: string,
): string | null {
  const target = parseISO(targetDate);
  let maxTemp = -Infinity;
  let peakHour: string | null = null;

  for (let i = 0; i < hourly.time.length; i++) {
    const t = parseISO(hourly.time[i]);
    if (!isSameDay(t, target)) continue;
    const temp = hourly.temperature_2m[i];
    if (temp > maxTemp) {
      maxTemp = temp;
      peakHour = hourly.time[i];
    }
  }

  return peakHour;
}

export function findRainWindows(
  hourly: OpenMeteoForecastResponse["hourly"],
  targetDate: string,
): Array<{ start: string; end: string }> | null {
  const target = parseISO(targetDate);
  const rainyIndices: number[] = [];

  for (let i = 0; i < hourly.time.length; i++) {
    const t = parseISO(hourly.time[i]);
    if (isSameDay(t, target) && hourly.precipitation[i] > 0) {
      rainyIndices.push(i);
    }
  }

  if (rainyIndices.length === 0) return null;

  const windows: Array<{ start: string; end: string }> = [];
  let windowStart = rainyIndices[0];
  let windowEnd = rainyIndices[0];

  for (let i = 1; i < rainyIndices.length; i++) {
    const idx = rainyIndices[i];
    if (idx <= windowEnd + 2) {
      windowEnd = idx;
    } else {
      windows.push({
        start: hourly.time[windowStart],
        end: hourly.time[windowEnd],
      });
      windowStart = idx;
      windowEnd = idx;
    }
  }

  windows.push({
    start: hourly.time[windowStart],
    end: hourly.time[windowEnd],
  });

  return windows;
}

export function getMiddayAqi(
  hourly: OpenMeteoAirQualityResponse["hourly"],
  targetDate: string,
): number | null {
  const target = parseISO(targetDate);

  for (let i = 0; i < hourly.time.length; i++) {
    const t = parseISO(hourly.time[i]);
    if (!isSameDay(t, target)) continue;
    const hour = t.getHours();
    if (hour >= 10 && hour <= 14) {
      const aqi = hourly.us_aqi[i];
      if (aqi !== null && aqi !== undefined) {
        return aqi;
      }
    }
  }

  return null;
}

export function aqiCategory(aqi: number): string {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for Sensitive Groups";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very Unhealthy";
  return "Hazardous";
}

export function weatherCodeToDescription(code: number): string {
  switch (code) {
    case 0:
      return "Clear sky";
    case 1:
      return "Mainly clear";
    case 2:
      return "Partly cloudy";
    case 3:
      return "Overcast";
    case 45:
    case 48:
      return "Fog";
    case 51:
    case 53:
    case 55:
      return "Drizzle";
    case 56:
    case 57:
      return "Freezing drizzle";
    case 61:
    case 63:
    case 65:
      return "Rain";
    case 66:
    case 67:
      return "Freezing rain";
    case 71:
    case 73:
    case 75:
      return "Snow";
    case 77:
      return "Snow grains";
    case 80:
    case 81:
    case 82:
      return "Rain showers";
    case 85:
    case 86:
      return "Snow showers";
    case 95:
      return "Thunderstorm";
    case 96:
    case 99:
      return "Thunderstorm with hail";
    default:
      return "Unknown";
  }
}

function formatTimeRange(
  startIso: string,
  endIso: string,
  timezone: string,
): string {
  const start = new TZDate(startIso, timezone);
  const end = new TZDate(endIso, timezone);
  const startStr = format(start, "h:mm a");
  const endStr = format(end, "h:mm a");
  return `${startStr} to ${endStr}`;
}

function formatSingleTime(iso: string, timezone: string): string {
  return format(new TZDate(iso, timezone), "h:mm a");
}

export function formatWeatherSummary(
  forecast: OpenMeteoForecastResponse,
  airQuality: OpenMeteoAirQualityResponse | null,
  targetDate: string,
  timezone: string,
): string {
  const target = parseISO(targetDate);
  const dayIndex = forecast.daily.time.findIndex((d) =>
    isSameDay(parseISO(d), target),
  );

  if (dayIndex === -1) {
    return "Weather data is currently unavailable.";
  }

  const code = forecast.daily.weather_code[dayIndex];
  const high = Math.round(forecast.daily.temperature_2m_max[dayIndex]);
  const low = Math.round(forecast.daily.temperature_2m_min[dayIndex]);
  const apparentHigh = Math.round(
    forecast.daily.apparent_temperature_max[dayIndex],
  );
  const apparentLow = Math.round(
    forecast.daily.apparent_temperature_min[dayIndex],
  );
  const precipSum = forecast.daily.precipitation_sum[dayIndex];

  const condition = weatherCodeToDescription(code);

  const peakHour = findPeakTempHour(forecast.hourly, targetDate);
  const peakTimeStr = peakHour
    ? ` around ${formatSingleTime(peakHour, timezone)}`
    : "";

  const useApparentHigh = apparentHigh !== high;
  const useApparentLow = apparentLow !== low;

  const highStr = useApparentHigh
    ? `${high}°F (feels like ${apparentHigh}°F)`
    : `${high}°F`;
  const lowStr = useApparentLow
    ? `${low}°F (feels like ${apparentLow}°F)`
    : `${low}°F`;

  let rainText = "";
  if (precipSum === 0) {
    rainText = " No rain expected.";
  } else {
    const windows = findRainWindows(forecast.hourly, targetDate);
    if (windows && windows.length > 0) {
      const windowStrs = windows.map((w) =>
        formatTimeRange(w.start, w.end, timezone),
      );
      const joined =
        windowStrs.length === 1
          ? windowStrs[0]
          : `${windowStrs.slice(0, -1).join(", ")} and ${windowStrs[windowStrs.length - 1]}`;
      rainText = ` Rain expected from ${joined}.`;
    }
  }

  let aqiText = "";
  if (airQuality) {
    const middayAqi = getMiddayAqi(airQuality.hourly, targetDate);
    if (middayAqi !== null && middayAqi > 50) {
      aqiText = ` Air quality is ${aqiCategory(middayAqi)} (AQI ${middayAqi}).`;
    }
  }

  return `${condition}. High of ${highStr}, low of ${lowStr}, with the high reached${peakTimeStr}.${rainText}${aqiText}`;
}
