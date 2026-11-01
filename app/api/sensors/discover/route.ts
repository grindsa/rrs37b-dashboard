import { connection } from "next/server";
import { NextResponse } from "next/server";
import { discoverBthomeDevices } from "@/lib/shelly";
import { getShellyBindings, uniqueGatewayIps } from "@/lib/shelly-config";

/**
 * Lists BTHome devices currently paired on the configured gateway plugs.
 * Use this once to fill SHELLY_SENSOR_* MAC values in .env.
 */
export async function GET() {
  await connection();

  try {
    const hosts = uniqueGatewayIps(getShellyBindings());
    const devices = await discoverBthomeDevices(hosts);
    return NextResponse.json({
      hosts,
      devices,
      fetchedAt: new Date().toISOString(),
      hint:
        devices.length === 0
          ? "No BTHome devices found. In each Plug UI: enable Bluetooth observer, add BLU H&T, then add temperature + humidity sensors."
          : "Copy each device mac into SHELLY_SENSOR_AUSSEN / _ARBEITSZIMMER / _WOHNZIMMER.",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Discovery failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
