/**
 * Shared PV snapshot types + merge helper (safe for client components).
 */

export type PvHouseSnapshot = {
  houseW: number | null;
  fetchedAt: string;
  warnings: string[];
};

export type PvRestSnapshot = {
  socPct: number | null;
  /** Battery charge power (W) when NOAH reports it. */
  chargeW: number | null;
  /** Battery discharge power (W) when NOAH reports it. */
  dischargeW: number | null;
  /** PV input into the NOAH appliance (W), not EZ1-M. */
  noahSolarW: number | null;
  /** Growatt work mode, e.g. load_first / battery_first. */
  workMode: string | null;
  /** APsystems EZ1-M generation (W). */
  solarW: number | null;
  fetchedAt: string;
  warnings: string[];
};

export type PvSnapshot = {
  socPct: number | null;
  chargeW: number | null;
  dischargeW: number | null;
  noahSolarW: number | null;
  workMode: string | null;
  solarW: number | null;
  houseW: number | null;
  /** solarW − houseW when both readings exist. */
  netW: number | null;
  fetchedAt: string;
  warnings: string[];
};

function laterIso(a: string, b: string): string {
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

export function mergePvParts(
  house: PvHouseSnapshot | null | undefined,
  rest: PvRestSnapshot | null | undefined,
): PvSnapshot {
  const houseW = house?.houseW ?? null;
  const solarW = rest?.solarW ?? null;
  const houseAt = house?.fetchedAt;
  const restAt = rest?.fetchedAt;
  const fetchedAt =
    houseAt && restAt
      ? laterIso(houseAt, restAt)
      : (houseAt ?? restAt ?? new Date().toISOString());

  return {
    socPct: rest?.socPct ?? null,
    chargeW: rest?.chargeW ?? null,
    dischargeW: rest?.dischargeW ?? null,
    noahSolarW: rest?.noahSolarW ?? null,
    workMode: rest?.workMode ?? null,
    solarW,
    houseW,
    netW: solarW !== null && houseW !== null ? solarW - houseW : null,
    fetchedAt,
    warnings: [...(house?.warnings ?? []), ...(rest?.warnings ?? [])],
  };
}
