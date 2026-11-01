/**
 * Open-Meteo adapter — next hour + 6-hour strip.
 */

import { CACHE_TTL, cacheGetOrSet } from "./cache";

export type WeatherHour = {
  time: string;
  temperatureC: number;
  precipitationMm: number;
  weatherCode: number;
};

export type WeatherSnapshot = {
  nextHour: WeatherHour;
  next6Hours: WeatherHour[];
  fetchedAt: string;
  lat: number;
  lon: number;
};

type OpenMeteoHourly = {
  time: string[];
  temperature_2m: number[];
  precipitation: number[];
  weather_code: number[];
};

type OpenMeteoResponse = {
  hourly: OpenMeteoHourly;
};

function requireCoord(name: string, value: string | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Missing or invalid env ${name}`);
  }
  return n;
}

function pickHours(hourly: OpenMeteoHourly, now = new Date()): WeatherHour[] {
  const hours: WeatherHour[] = hourly.time.map((time, index) => ({
    time,
    temperatureC: hourly.temperature_2m[index],
    precipitationMm: hourly.precipitation[index],
    weatherCode: hourly.weather_code[index],
  }));

  // Prefer the upcoming hour (ceil to next full hour); fall back to current slot.
  const nextIdx = hours.findIndex((h) => new Date(h.time).getTime() > now.getTime());
  const start = nextIdx === -1 ? Math.max(0, hours.length - 6) : nextIdx;
  return hours.slice(start, start + 6);
}

async function loadWeather(): Promise<WeatherSnapshot> {
  const lat = requireCoord("OPEN_METEO_LAT", process.env.OPEN_METEO_LAT);
  const lon = requireCoord("OPEN_METEO_LON", process.env.OPEN_METEO_LON);

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set(
    "hourly",
    "temperature_2m,precipitation,weather_code",
  );
  url.searchParams.set("timezone", "Europe/Berlin");
  url.searchParams.set("forecast_days", "2");

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Open-Meteo HTTP ${response.status}`);
  }

  const payload = (await response.json()) as OpenMeteoResponse;
  const next6Hours = pickHours(payload.hourly);
  if (next6Hours.length === 0) {
    throw new Error("Open-Meteo returned no hourly data");
  }

  return {
    nextHour: next6Hours[0],
    next6Hours,
    fetchedAt: new Date().toISOString(),
    lat,
    lon,
  };
}

export async function getWeather(): Promise<WeatherSnapshot> {
  return cacheGetOrSet("weather:snapshot", CACHE_TTL.weather, loadWeather);
}
