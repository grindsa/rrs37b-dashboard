/**
 * Open-Meteo adapter — next hour + 6-hour strip.
 * Implementation in a later phase.
 */

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
};

export async function getWeather(): Promise<WeatherSnapshot> {
  throw new Error("Open-Meteo adapter not implemented yet");
}
