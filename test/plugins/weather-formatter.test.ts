import { describe, it, expect } from 'vitest';
import {
  findPeakTempHour,
  findRainWindows,
  getMiddayAqi,
  aqiCategory,
  weatherCodeToDescription,
  formatWeatherSummary
} from '../../src/plugins/weather-formatter.js';

function makeHourly(times: string[], temps: number[], precip: number[]) {
  return {
    time: times,
    temperature_2m: temps,
    precipitation: precip,
    precipitation_probability: precip.map(() => 50)
  };
}

function makeDaily(overrides: Partial<typeof dailyBase> = {}) {
  return { ...dailyBase, ...overrides };
}

const dailyBase = {
  time: ['2026-05-08', '2026-05-09'],
  temperature_2m_max: [75, 80],
  temperature_2m_min: [55, 60],
  apparent_temperature_max: [78, 83],
  apparent_temperature_min: [56, 61],
  precipitation_sum: [0.1, 0],
  precipitation_hours: [2, 0],
  precipitation_probability_max: [60, 10],
  weather_code: [61, 0]
};

describe('findPeakTempHour', () => {
  it('returns the hour of the highest temperature', () => {
    const times = ['2026-05-08T10:00', '2026-05-08T14:00', '2026-05-08T18:00'];
    const hourly = makeHourly(times, [65, 75, 70], [0, 0, 0]);
    expect(findPeakTempHour(hourly, '2026-05-08')).toBe('2026-05-08T14:00');
  });

  it('returns the first occurrence if multiple hours share the max', () => {
    const times = ['2026-05-08T12:00', '2026-05-08T13:00', '2026-05-08T14:00'];
    const hourly = makeHourly(times, [75, 75, 70], [0, 0, 0]);
    expect(findPeakTempHour(hourly, '2026-05-08')).toBe('2026-05-08T12:00');
  });

  it('returns null when target date has no data', () => {
    const hourly = makeHourly(['2026-05-09T12:00'], [70], [0]);
    expect(findPeakTempHour(hourly, '2026-05-08')).toBeNull();
  });
});

describe('findRainWindows', () => {
  it('returns null when there is no rain', () => {
    const times = ['2026-05-08T08:00', '2026-05-08T09:00', '2026-05-08T10:00'];
    const hourly = makeHourly(times, [60, 60, 60], [0, 0, 0]);
    expect(findRainWindows(hourly, '2026-05-08')).toBeNull();
  });

  it('detects a single rain window', () => {
    const times = ['2026-05-08T12:00', '2026-05-08T13:00', '2026-05-08T14:00'];
    const hourly = makeHourly(times, [60, 60, 60], [0, 0.1, 0.2]);
    const windows = findRainWindows(hourly, '2026-05-08')!;
    expect(windows).toHaveLength(1);
    expect(windows[0].start).toBe('2026-05-08T13:00');
    expect(windows[0].end).toBe('2026-05-08T14:00');
  });

  it('merges windows separated by one dry hour', () => {
    const times = [
      '2026-05-08T12:00',
      '2026-05-08T13:00',
      '2026-05-08T14:00',
      '2026-05-08T15:00',
      '2026-05-08T16:00'
    ];
    const hourly = makeHourly(times, [60, 60, 60, 60, 60], [0.1, 0, 0.2, 0.3, 0]);
    const windows = findRainWindows(hourly, '2026-05-08')!;
    expect(windows).toHaveLength(1);
    expect(windows[0].start).toBe('2026-05-08T12:00');
    expect(windows[0].end).toBe('2026-05-08T15:00');
  });

  it('keeps windows separate when gap is two or more dry hours', () => {
    const times = [
      '2026-05-08T10:00',
      '2026-05-08T11:00',
      '2026-05-08T12:00',
      '2026-05-08T13:00',
      '2026-05-08T14:00'
    ];
    const hourly = makeHourly(times, [60, 60, 60, 60, 60], [0.1, 0, 0, 0.2, 0]);
    const windows = findRainWindows(hourly, '2026-05-08')!;
    expect(windows).toHaveLength(2);
  });
});

describe('getMiddayAqi', () => {
  it('returns the AQI at midday', () => {
    const hourly = {
      time: ['2026-05-08T08:00', '2026-05-08T12:00', '2026-05-08T16:00'],
      us_aqi: [30, 55, 40],
      pm2_5: [5, 10, 8],
      ozone: [30, 35, 32]
    };
    expect(getMiddayAqi(hourly, '2026-05-08')).toBe(55);
  });

  it('returns null when midday has no data', () => {
    const hourly = {
      time: ['2026-05-08T08:00'],
      us_aqi: [30],
      pm2_5: [5],
      ozone: [30]
    };
    expect(getMiddayAqi(hourly, '2026-05-08')).toBeNull();
  });

  it('skips null AQI values and finds the next valid reading in the midday window', () => {
    const hourly = {
      time: ['2026-05-08T10:00', '2026-05-08T11:00', '2026-05-08T12:00'],
      us_aqi: [null, null, 62],
      pm2_5: [null, null, 12],
      ozone: [null, null, 40]
    };
    expect(getMiddayAqi(hourly, '2026-05-08')).toBe(62);
  });
});

describe('aqiCategory', () => {
  it.each([
    [15, 'Good'],
    [55, 'Moderate'],
    [105, 'Unhealthy for Sensitive Groups'],
    [155, 'Unhealthy'],
    [205, 'Very Unhealthy'],
    [305, 'Hazardous']
  ])('AQI %i → %s', (aqi, expected) => {
    expect(aqiCategory(aqi)).toBe(expected);
  });
});

describe('weatherCodeToDescription', () => {
  it.each([
    [0, 'Clear sky'],
    [1, 'Mainly clear'],
    [2, 'Partly cloudy'],
    [3, 'Overcast'],
    [45, 'Fog'],
    [48, 'Fog'],
    [61, 'Rain'],
    [63, 'Rain'],
    [65, 'Rain'],
    [71, 'Snow'],
    [73, 'Snow'],
    [75, 'Snow'],
    [80, 'Rain showers'],
    [81, 'Rain showers'],
    [82, 'Rain showers'],
    [95, 'Thunderstorm'],
    [96, 'Thunderstorm with hail'],
    [99, 'Thunderstorm with hail']
  ])('code %i → %s', (code, expected) => {
    expect(weatherCodeToDescription(code)).toBe(expected);
  });

  it('returns \'Unknown\' for unmapped codes', () => {
    expect(weatherCodeToDescription(999)).toBe('Unknown');
  });
});

describe('formatWeatherSummary', () => {
  it('formats a complete summary with rain and moderate AQI', () => {
    const forecast = {
      latitude: 40.0583,
      longitude: -74.4057,
      timezone: 'America/New_York',
      daily: makeDaily(),
      hourly: makeHourly(
        ['2026-05-08T10:00', '2026-05-08T14:00', '2026-05-08T18:00'],
        [65, 75, 70],
        [0, 0.1, 0]
      )
    };

    const airQuality = {
      latitude: 40.0583,
      longitude: -74.4057,
      timezone: 'America/New_York',
      hourly: {
        time: ['2026-05-08T12:00'],
        us_aqi: [55],
        pm2_5: [10],
        ozone: [35]
      }
    };

    const text = formatWeatherSummary(
      forecast,
      airQuality,
      '2026-05-08',
      'America/New_York'
    );
    expect(text).toContain('Rain');
    expect(text).toContain('75°F');
    expect(text).toContain('55°F');
    expect(text).toContain('Rain expected');
    expect(text).toContain('AQI');
    expect(text).toContain('Moderate');
  });

  it('omits AQI when it is Good', () => {
    const forecast = {
      latitude: 40.0583,
      longitude: -74.4057,
      timezone: 'America/New_York',
      daily: makeDaily(),
      hourly: makeHourly(['2026-05-08T14:00'], [75], [0])
    };

    const airQuality = {
      latitude: 40.0583,
      longitude: -74.4057,
      timezone: 'America/New_York',
      hourly: {
        time: ['2026-05-08T12:00'],
        us_aqi: [25],
        pm2_5: [5],
        ozone: [30]
      }
    };

    const text = formatWeatherSummary(
      forecast,
      airQuality,
      '2026-05-08',
      'America/New_York'
    );
    expect(text).not.toContain('AQI');
  });

  it('omits AQI when air quality data is null', () => {
    const forecast = {
      latitude: 40.0583,
      longitude: -74.4057,
      timezone: 'America/New_York',
      daily: makeDaily(),
      hourly: makeHourly(['2026-05-08T14:00'], [75], [0])
    };

    const text = formatWeatherSummary(
      forecast,
      null,
      '2026-05-08',
      'America/New_York'
    );
    expect(text).not.toContain('AQI');
  });

  it('reports \'no rain expected\' when precipitation sum is zero', () => {
    const forecast = {
      latitude: 40.0583,
      longitude: -74.4057,
      timezone: 'America/New_York',
      daily: makeDaily({
        precipitation_sum: [0, 0],
        precipitation_hours: [0, 0]
      }),
      hourly: makeHourly(['2026-05-08T14:00'], [75], [0])
    };

    const text = formatWeatherSummary(
      forecast,
      null,
      '2026-05-08',
      'America/New_York'
    );
    expect(text).toContain('No rain expected');
  });

  it('handles missing forecast data gracefully', () => {
    const forecast = {
      latitude: 40.0583,
      longitude: -74.4057,
      timezone: 'America/New_York',
      daily: makeDaily({ time: ['2026-05-09', '2026-05-10'] }),
      hourly: makeHourly(['2026-05-09T14:00'], [75], [0])
    };

    const text = formatWeatherSummary(
      forecast,
      null,
      '2026-05-08',
      'America/New_York'
    );
    expect(text).toContain('unavailable');
  });
});
