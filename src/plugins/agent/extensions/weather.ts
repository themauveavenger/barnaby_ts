import type { ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import {
  formatWeatherSummary,
  type OpenMeteoForecastResponse,
  type OpenMeteoAirQualityResponse
} from '../../weather-formatter.js';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

export default function createWeatherExtension(
  fastify: FastifyInstance
): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'get_weather_forecast',
      label: 'Get Weather Forecast',
      description:
        'Fetches today\'s weather forecast and air quality for the user\'s fixed location. Returns the weather condition, high/low temperature, approximate time of the daily high, rain expectations with timing, and US Air Quality Index if moderate or worse.',
      parameters: Type.Object({}),
      async execute(_toolCallId, _params) {
        const latitude = process.env.WEATHER_LATITUDE;
        const longitude = process.env.WEATHER_LONGITUDE;

        if (!latitude || !longitude) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Error: Weather location is not configured. Set WEATHER_LATITUDE and WEATHER_LONGITUDE environment variables.'
              }
            ],
            details: {}
          };
        }

        const today = new Date().toISOString().split('T')[0];
        const timezone = fastify.timezone;

        const forecastParams = new URLSearchParams({
          latitude,
          longitude,
          daily: [
            'temperature_2m_max',
            'temperature_2m_min',
            'apparent_temperature_max',
            'apparent_temperature_min',
            'precipitation_sum',
            'precipitation_hours',
            'precipitation_probability_max',
            'weather_code'
          ].join(','),
          hourly: [
            'temperature_2m',
            'precipitation',
            'precipitation_probability'
          ].join(','),
          temperature_unit: 'fahrenheit',
          precipitation_unit: 'inch',
          timezone,
          forecast_days: '2'
        });

        const aqParams = new URLSearchParams({
          latitude,
          longitude,
          hourly: ['us_aqi', 'pm2_5', 'ozone'].join(','),
          timezone,
          forecast_days: '2'
        });

        try {
          const [forecastRes, aqRes] = await Promise.all([
            fetch(`${FORECAST_URL}?${forecastParams.toString()}`),
            fetch(`${AIR_QUALITY_URL}?${aqParams.toString()}`)
          ]);

          if (!forecastRes.ok) {
            throw new Error(`Forecast API returned ${forecastRes.status}`);
          }

          const forecast = (await forecastRes.json()) as OpenMeteoForecastResponse;

          let airQuality: OpenMeteoAirQualityResponse | null = null;
          if (aqRes.ok) {
            airQuality = (await aqRes.json()) as OpenMeteoAirQualityResponse;
          }
          else {
            fastify.log.warn(
              `Air quality API returned ${aqRes.status}; omitting AQI`
            );
          }

          const text = formatWeatherSummary(
            forecast,
            airQuality,
            today,
            timezone
          );
          return {
            content: [{ type: 'text' as const, text }],
            details: {}
          };
        }
        catch (error) {
          fastify.log.error(error, 'Failed to fetch weather forecast');
          const message
            = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: Failed to fetch weather data. ${message}`
              }
            ],
            details: {}
          };
        }
      }
    });
  };
}
