import type { ShellySensor } from "./shelly";
import type { WeatherSnapshot } from "./weather";
import type { BvgStopDepartures } from "./bvg";

/** Fixed dummy clock so SSR/client match for remaining demo sections. */
export const DUMMY_NOW = "2026-11-01T07:18:00+01:00";

/** Fallback while /api/sensors loads or if the request fails hard. */
export const DUMMY_SENSORS: ShellySensor[] = [
  {
    id: "aussen",
    label: "Aussen",
    temperatureC: 6.4,
    humidityPct: 78,
    batteryPct: 92,
    updatedAt: DUMMY_NOW,
    online: true,
  },
  {
    id: "arbeitszimmer",
    label: "Arbeitszimmer",
    temperatureC: 20.8,
    humidityPct: 41,
    batteryPct: 74,
    updatedAt: DUMMY_NOW,
    online: true,
  },
  {
    id: "wohnzimmer",
    label: "Wohnzimmer",
    temperatureC: 21.5,
    humidityPct: 44,
    batteryPct: 61,
    updatedAt: DUMMY_NOW,
    online: true,
  },
];

export const DUMMY_WEATHER: WeatherSnapshot = {
  fetchedAt: DUMMY_NOW,
  lat: 52.565379,
  lon: 13.441779,
  nextHour: {
    time: "2026-11-01T08:00:00+01:00",
    temperatureC: 7.2,
    precipitationMm: 0.2,
    weatherCode: 61,
  },
  next6Hours: [
    {
      time: "2026-11-01T08:00:00+01:00",
      temperatureC: 7.2,
      precipitationMm: 0.2,
      weatherCode: 61,
    },
    {
      time: "2026-11-01T09:00:00+01:00",
      temperatureC: 7.8,
      precipitationMm: 0.4,
      weatherCode: 63,
    },
    {
      time: "2026-11-01T10:00:00+01:00",
      temperatureC: 8.5,
      precipitationMm: 0.1,
      weatherCode: 3,
    },
    {
      time: "2026-11-01T11:00:00+01:00",
      temperatureC: 9.1,
      precipitationMm: 0,
      weatherCode: 2,
    },
    {
      time: "2026-11-01T12:00:00+01:00",
      temperatureC: 9.6,
      precipitationMm: 0,
      weatherCode: 1,
    },
    {
      time: "2026-11-01T13:00:00+01:00",
      temperatureC: 10.0,
      precipitationMm: 0,
      weatherCode: 0,
    },
  ],
};

function departureAt(iso: string): string {
  return iso;
}

export const DUMMY_BVG: BvgStopDepartures[] = [
  {
    stopId: "900141002",
    stopName: "Heinersdorf Kirche",
    fetchedAt: DUMMY_NOW,
    departures: [
      {
        line: "M27",
        direction: "S+U Hermannplatz",
        when: departureAt("2026-11-01T07:22:00+01:00"),
        plannedWhen: "2026-11-01T07:20:00+01:00",
        delaySeconds: 120,
        cancelled: false,
      },
      {
        line: "150",
        direction: "Buchholz",
        when: departureAt("2026-11-01T07:27:00+01:00"),
        plannedWhen: "2026-11-01T07:27:00+01:00",
        delaySeconds: 0,
        cancelled: false,
      },
      {
        line: "M27",
        direction: "S+U Pankow",
        when: departureAt("2026-11-01T07:34:00+01:00"),
        plannedWhen: "2026-11-01T07:35:00+01:00",
        delaySeconds: -60,
        cancelled: false,
      },
      {
        line: "150",
        direction: "S Buch",
        when: departureAt("2026-11-01T07:41:00+01:00"),
        plannedWhen: "2026-11-01T07:41:00+01:00",
        delaySeconds: 0,
        cancelled: false,
      },
    ],
  },
  {
    stopId: "900141508",
    stopName: "Rudolf-Spitzley-Str.",
    fetchedAt: DUMMY_NOW,
    departures: [
      {
        line: "155",
        direction: "Weißensee",
        when: departureAt("2026-11-01T07:24:00+01:00"),
        plannedWhen: "2026-11-01T07:24:00+01:00",
        delaySeconds: 0,
        cancelled: false,
      },
      {
        line: "155",
        direction: "S Buch",
        when: departureAt("2026-11-01T07:31:00+01:00"),
        plannedWhen: "2026-11-01T07:29:00+01:00",
        delaySeconds: 120,
        cancelled: false,
      },
      {
        line: "N50",
        direction: "Hertzallee",
        when: null,
        plannedWhen: "2026-11-01T07:40:00+01:00",
        delaySeconds: null,
        cancelled: true,
      },
    ],
  },
];
