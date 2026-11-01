/**
 * BVG live departures via https://v6.bvg.transport.rest
 * Implementation in a later phase.
 */

export type BvgDeparture = {
  line: string;
  direction: string;
  when: string | null;
  plannedWhen: string | null;
  delaySeconds: number | null;
  cancelled: boolean;
};

export type BvgStopDepartures = {
  stopId: string;
  stopName: string;
  departures: BvgDeparture[];
  fetchedAt: string;
};

export async function getBvgDepartures(): Promise<BvgStopDepartures[]> {
  throw new Error("BVG adapter not implemented yet");
}
