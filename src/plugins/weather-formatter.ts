import { format, isSameDay, parseISO } from 'date-fns';
import { TZDate } from '@date-fns/tz';
import { match, P } from 'ts-pattern';

export interface OpenMeteoForecastResponse {
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
}

export interface OpenMeteoAirQualityResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  hourly: {
    time: string[];
    us_aqi: (number | null)[];
    pm2_5: (number | null)[];
    ozone: (number | null)[];
  };
}

export function findPeakTempHour(
  hourly: OpenMeteoForecastResponse['hourly'],
  targetDate: string
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
  hourly: OpenMeteoForecastResponse['hourly'],
  targetDate: string
): { start: string; end: string }[] | null {
  const target = parseISO(targetDate);
  const rainyIndices: number[] = [];

  for (let i = 0; i < hourly.time.length; i++) {
    const t = parseISO(hourly.time[i]);
    if (isSameDay(t, target) && hourly.precipitation[i] > 0) {
      rainyIndices.push(i);
    }
  }

  if (rainyIndices.length === 0) return null;

  const windows: { start: string; end: string }[] = [];
  let windowStart = rainyIndices[0];
  let windowEnd = rainyIndices[0];

  for (let i = 1; i < rainyIndices.length; i++) {
    const idx = rainyIndices[i];
    if (idx <= windowEnd + 2) {
      windowEnd = idx;
    } else {
      windows.push({
        start: hourly.time[windowStart],
        end: hourly.time[windowEnd]
      });
      windowStart = idx;
      windowEnd = idx;
    }
  }

  windows.push({
    start: hourly.time[windowStart],
    end: hourly.time[windowEnd]
  });

  return windows;
}

export function getMiddayAqi(
  hourly: OpenMeteoAirQualityResponse['hourly'],
  targetDate: string
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
  return match(aqi)
    .with(P.when(n => n <= 50), () => 'Good')
    .with(P.when(n => n <= 100), () => 'Moderate')
    .with(P.when(n => n <= 150), () => 'Unhealthy for Sensitive Groups')
    .with(P.when(n => n <= 200), () => 'Unhealthy')
    .with(P.when(n => n <= 300), () => 'Very Unhealthy')
    .otherwise(() => 'Hazardous');
}

export function weatherCodeToDescription(code: number): string {
  return match(code)
    .with(0, () => 'Clear sky')
    .with(1, () => 'Mainly clear')
    .with(2, () => 'Partly cloudy')
    .with(3, () => 'Overcast')
    .with(45, 48, () => 'Fog')
    .with(51, 53, 55, () => 'Drizzle')
    .with(56, 57, () => 'Freezing drizzle')
    .with(61, 63, 65, () => 'Rain')
    .with(66, 67, () => 'Freezing rain')
    .with(71, 73, 75, () => 'Snow')
    .with(77, () => 'Snow grains')
    .with(80, 81, 82, () => 'Rain showers')
    .with(85, 86, () => 'Snow showers')
    .with(95, () => 'Thunderstorm')
    .with(96, 99, () => 'Thunderstorm with hail')
    .otherwise(() => 'Unknown');
}

function formatTimeRange(
  startIso: string,
  endIso: string,
  timezone: string
): string {
  const start = new TZDate(startIso, timezone);
  const end = new TZDate(endIso, timezone);
  const startStr = format(start, 'h:mm a');
  const endStr = format(end, 'h:mm a');
  return `${startStr} to ${endStr}`;
}

function formatSingleTime(iso: string, timezone: string): string {
  return format(new TZDate(iso, timezone), 'h:mm a');
}

export function formatWeatherSummary(
  forecast: OpenMeteoForecastResponse,
  airQuality: OpenMeteoAirQualityResponse | null,
  targetDate: string,
  timezone: string
): string {
  const target = parseISO(targetDate);
  const dayIndex = forecast.daily.time.findIndex(d =>
    isSameDay(parseISO(d), target)
  );

  if (dayIndex === -1) {
    return 'Weather data is currently unavailable.';
  }

  const code = forecast.daily.weather_code[dayIndex];
  const high = Math.round(forecast.daily.temperature_2m_max[dayIndex]);
  const low = Math.round(forecast.daily.temperature_2m_min[dayIndex]);
  const apparentHigh = Math.round(
    forecast.daily.apparent_temperature_max[dayIndex]
  );
  const apparentLow = Math.round(
    forecast.daily.apparent_temperature_min[dayIndex]
  );
  const precipSum = forecast.daily.precipitation_sum[dayIndex];

  const condition = weatherCodeToDescription(code);

  const peakHour = findPeakTempHour(forecast.hourly, targetDate);
  const peakTimeStr = match(peakHour)
    .with(null, () => '')
    .otherwise(hour => ` around ${formatSingleTime(hour, timezone)}`);

  const useApparentHigh = apparentHigh !== high;
  const useApparentLow = apparentLow !== low;

  const highStr = useApparentHigh
    ? `${high}°F (feels like ${apparentHigh}°F)`
    : `${high}°F`;
  const lowStr = useApparentLow
    ? `${low}°F (feels like ${apparentLow}°F)`
    : `${low}°F`;

  let rainText = '';
  if (precipSum === 0) {
    rainText = ' No rain expected.';
  } else {
    const windows = findRainWindows(forecast.hourly, targetDate);
    if (windows && windows.length > 0) {
      const windowStrs = windows.map(w =>
        formatTimeRange(w.start, w.end, timezone)
      );
      const joined
        = windowStrs.length === 1
          ? windowStrs[0]
          : `${windowStrs.slice(0, -1).join(', ')} and ${windowStrs[windowStrs.length - 1]}`;
      rainText = ` Rain expected from ${joined}.`;
    }
  }

  let aqiText = '';
  if (airQuality) {
    const middayAqi = getMiddayAqi(airQuality.hourly, targetDate);
    if (middayAqi !== null && middayAqi > 50) {
      aqiText = ` Air quality is ${aqiCategory(middayAqi)} (AQI ${middayAqi}).`;
    }
  }

  return `${condition}. High of ${highStr}, low of ${lowStr}, with the high reached${peakTimeStr}.${rainText}${aqiText}`;
}
